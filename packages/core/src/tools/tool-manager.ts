import { MCPManager } from '../mcp/manager.js';
import type { ToolPolicies } from './schemas.js';
import {
    ToolSet,
    ToolExecutionContext,
    ToolExecutionContextBase,
    Tool,
    ToolPresentationSnapshotV1,
} from './types.js';
import type { ToolDisplayData } from './display-types.js';
import { ToolError } from './errors.js';
import { ToolErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/index.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { convertZodSchemaToJsonSchema } from '../utils/schema.js';
import type { AgentEventBus } from '../events/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus, ApprovalType, DenialReason } from '../approval/types.js';
import type {
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    DirectoryAccessMetadata,
} from '../approval/types.js';
import type { AllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../hooks/types.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { WorkspaceContext } from '../workspace/types.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import { extractToolCallMeta, wrapToolParametersSchema } from './tool-call-metadata.js';
import { isBackgroundTasksEnabled } from '../utils/env.js';
import type {
    DynamicContributorContext,
    DynamicContributorContextFactory,
} from '../systemPrompt/types.js';

export type ToolExecutionContextFactory = (
    baseContext: ToolExecutionContextBase
) => ToolExecutionContext;
/**
 * Unified Tool Manager - Single interface for all tool operations
 *
 * This class acts as the single point of contact between the LLM and all tool sources.
 * It aggregates tools from MCP servers and local tools, providing a unified interface
 * for tool discovery, aggregation, and execution.
 *
 * Responsibilities:
 * - Aggregate tools from MCP servers and local tools with conflict resolution
 * - Route tool execution to appropriate source (MCP vs local)
 * - Provide unified tool interface to LLM
 * - Manage tool approvals and security via ApprovalManager
 * - Handle cross-source naming conflicts (MCP tools are prefixed with `mcp--`)
 *
 * Architecture:
 * LLMService → ToolManager → [MCPManager, local tools]
 *                ↓
 *          ApprovalManager (for approvals)
 *
 * TODO (Telemetry): Add OpenTelemetry metrics collection
 *   - Tool execution counters (by tool name, source: MCP/internal)
 *   - Tool execution latency histograms
 *   - Tool success/failure rate counters
 *   - Tool approval/denial counters
 *   See feature-plans/telemetry.md for details
 */
@InstrumentClass({
    prefix: 'tool',
    excludeMethods: ['setHookSupport', 'getApprovalManager', 'getAllowedToolsProvider'],
})
export class ToolManager {
    private mcpManager: MCPManager;
    private agentTools: Map<string, Tool> = new Map();
    private approvalManager: ApprovalManager;
    private allowedToolsProvider: AllowedToolsProvider;
    private approvalMode: 'manual' | 'auto-approve' | 'auto-deny';
    private agentEventBus: AgentEventBus;
    private toolPolicies: ToolPolicies | undefined;
    private toolExecutionContextFactory: ToolExecutionContextFactory;
    private contributorContextFactory: DynamicContributorContextFactory | undefined;

    // Hook support - set after construction to avoid circular dependencies
    private hookManager?: HookManager;
    private sessionManager?: SessionManager;
    private stateManager?: AgentStateManager;
    private workspaceManager?: WorkspaceManager;
    private currentWorkspace: WorkspaceContext | undefined;
    private workspaceListenerAttached = false;
    private readonly workspaceListenerAbort = new AbortController();

    // Tool naming:
    // - MCP tools are prefixed with `mcp--` for disambiguation.
    // - Local tools use their `Tool.id` as-is (no internal/custom prefixing).
    private static readonly MCP_TOOL_PREFIX = 'mcp--';

    // Tool caching for performance
    private toolsCache: ToolSet = {};
    private cacheValid: boolean = false;
    private logger: Logger;

    // Session-level auto-approve tools for skills
    // When a skill with allowedTools is invoked, those tools are auto-approved (skip confirmation)
    // This is ADDITIVE - other tools are NOT blocked, they just go through normal approval flow
    private sessionAutoApproveTools: Map<string, string[]> = new Map();
    // Session-level auto-approve tools set by users (UI)
    private sessionUserAutoApproveTools: Map<string, string[]> = new Map();
    private sessionDisabledTools: Map<string, string[]> = new Map();
    private globalDisabledTools: string[] = [];
    private cleanupHandlers: Set<() => Promise<void> | void> = new Set();
    private cleanupStarted = false;

    private resolveLocalToolIdOrAlias(name: string): string | null {
        const direct = this.agentTools.get(name);
        if (direct) return direct.id;

        const lower = name.toLowerCase();
        for (const tool of this.agentTools.values()) {
            if (tool.id.toLowerCase() === lower) {
                return tool.id;
            }
            if (tool.aliases?.some((alias) => alias.toLowerCase() === lower)) {
                return tool.id;
            }
        }

        return null;
    }

    private normalizeToolPolicyPattern(pattern: string): string {
        if (pattern.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return pattern;
        }

        return this.resolveLocalToolIdOrAlias(pattern) ?? pattern;
    }

    constructor(
        mcpManager: MCPManager,
        approvalManager: ApprovalManager,
        allowedToolsProvider: AllowedToolsProvider,
        approvalMode: 'manual' | 'auto-approve' | 'auto-deny',
        agentEventBus: AgentEventBus,
        toolPolicies: ToolPolicies,
        tools: Tool[],
        logger: Logger
    ) {
        this.mcpManager = mcpManager;
        this.approvalManager = approvalManager;
        this.allowedToolsProvider = allowedToolsProvider;
        this.approvalMode = approvalMode;
        this.agentEventBus = agentEventBus;
        this.toolPolicies = toolPolicies;
        this.logger = logger.createChild(DextoLogComponent.TOOLS);
        this.setTools(tools);
        this.toolExecutionContextFactory = () => {
            throw ToolError.configInvalid(
                'ToolExecutionContextFactory not configured. DextoAgent.start() must configure tool execution context before tools can run.'
            );
        };

        // Set up event listeners for surgical cache updates
        this.setupNotificationListeners();

        this.logger.debug('ToolManager initialized');
    }

    /**
     * Initialize the ToolManager and its components
     */
    async initialize(): Promise<void> {
        this.logger.debug('ToolManager initialization complete');
    }

    setTools(tools: Tool[]): void {
        this.agentTools.clear();
        for (const tool of tools) {
            this.agentTools.set(tool.id, tool);
        }
        this.invalidateCache();
    }

    addTools(tools: Tool[]): string[] {
        const added: string[] = [];
        for (const tool of tools) {
            if (this.agentTools.has(tool.id)) {
                continue;
            }
            this.agentTools.set(tool.id, tool);
            added.push(tool.id);
        }
        if (added.length > 0) {
            this.invalidateCache();
        }
        return added;
    }

    setToolExecutionContextFactory(factory: ToolExecutionContextFactory): void {
        this.toolExecutionContextFactory = factory;
    }

    registerCleanup(handler: () => Promise<void> | void): void {
        this.cleanupHandlers.add(handler);
    }

    async cleanup(): Promise<void> {
        if (this.cleanupStarted) {
            return;
        }
        this.cleanupStarted = true;
        for (const handler of this.cleanupHandlers) {
            try {
                await handler();
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.logger.warn(`ToolManager cleanup handler failed: ${err.message}`, {
                    color: 'yellow',
                });
            }
        }
    }

    /**
     * Set hook support services (called after construction to avoid circular dependencies)
     */
    setHookSupport(
        hookManager: HookManager,
        sessionManager: SessionManager,
        stateManager: AgentStateManager
    ): void {
        this.hookManager = hookManager;
        this.sessionManager = sessionManager;
        this.stateManager = stateManager;
        this.logger.debug('Hook support configured for ToolManager');
    }

    /**
     * Set workspace manager for tool execution context propagation.
     */
    setWorkspaceManager(workspaceManager: WorkspaceManager): void {
        this.workspaceManager = workspaceManager;
        void this.refreshWorkspace();

        if (!this.workspaceListenerAttached) {
            this.workspaceListenerAttached = true;
            this.agentEventBus.on(
                'workspace:changed',
                (payload) => {
                    this.currentWorkspace = payload.workspace ?? undefined;
                },
                { signal: this.workspaceListenerAbort.signal }
            );
            this.registerCleanup(() => {
                if (!this.workspaceListenerAbort.signal.aborted) {
                    this.workspaceListenerAbort.abort();
                }
            });
        }

        this.logger.debug('WorkspaceManager reference configured for ToolManager');
    }

    private async refreshWorkspace(): Promise<void> {
        if (!this.workspaceManager) {
            return;
        }

        try {
            this.currentWorkspace = await this.workspaceManager.getWorkspace();
        } catch (error) {
            this.logger.debug(
                `Failed to refresh workspace context: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    // ============= SESSION AUTO-APPROVE TOOLS =============

    /**
     * Set session-level auto-approve tools.
     * When set, these tools will skip confirmation prompts for this session.
     * This is ADDITIVE - other tools are NOT blocked, they just go through normal approval flow.
     *
     * @param sessionId The session ID
     * @param autoApproveTools Array of tool names to auto-approve (e.g., ['bash_exec', 'mcp--read_file'])
     */
    setSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        // Empty array = no auto-approvals, same as clearing
        if (autoApproveTools.length === 0) {
            this.clearSessionAutoApproveTools(sessionId);
            return;
        }
        const normalized = autoApproveTools.map((pattern) =>
            this.normalizeToolPolicyPattern(pattern)
        );
        this.sessionAutoApproveTools.set(sessionId, normalized);
        this.logger.info(
            `Session auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`Auto-approve tools: ${normalized.join(', ')}`);
    }

    /**
     * Add session-level auto-approve tools.
     * Merges into the existing list instead of replacing it.
     *
     * @param sessionId The session ID
     * @param autoApproveTools Array of tool names to auto-approve (e.g., ['bash_exec', 'mcp--read_file'])
     */
    addSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        if (autoApproveTools.length === 0) {
            return;
        }

        const normalized = autoApproveTools.map((pattern) =>
            this.normalizeToolPolicyPattern(pattern)
        );
        const existing = this.sessionAutoApproveTools.get(sessionId) ?? [];
        const merged = [...existing];
        const seen = new Set(existing);

        for (const toolName of normalized) {
            if (seen.has(toolName)) {
                continue;
            }
            merged.push(toolName);
            seen.add(toolName);
        }

        this.sessionAutoApproveTools.set(sessionId, merged);
        this.logger.info(
            `Session auto-approve tools updated for '${sessionId}': +${normalized.length} tools`
        );
        this.logger.debug(`Auto-approve tools: ${merged.join(', ')}`);
    }

    /**
     * Set session-level auto-approve tools chosen by the user.
     */
    setSessionUserAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        if (autoApproveTools.length === 0) {
            this.clearSessionUserAutoApproveTools(sessionId);
            return;
        }
        const normalized = autoApproveTools.map((pattern) =>
            this.normalizeToolPolicyPattern(pattern)
        );
        this.sessionUserAutoApproveTools.set(sessionId, normalized);
        this.logger.info(
            `Session user auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`User auto-approve tools: ${normalized.join(', ')}`);
    }

    /**
     * Clear session-level auto-approve tools chosen by the user.
     */
    clearSessionUserAutoApproveTools(sessionId: string): void {
        const hadAutoApprove = this.sessionUserAutoApproveTools.has(sessionId);
        this.sessionUserAutoApproveTools.delete(sessionId);
        if (hadAutoApprove) {
            this.logger.info(`Session user auto-approve tools cleared for '${sessionId}'`);
        }
    }

    /**
     * Clear session-level auto-approve tools.
     * Call this when the session ends or when the skill completes.
     *
     * @param sessionId The session ID to clear auto-approve tools for
     */
    clearSessionAutoApproveTools(sessionId: string): void {
        const hadAutoApprove = this.sessionAutoApproveTools.has(sessionId);
        this.sessionAutoApproveTools.delete(sessionId);
        if (hadAutoApprove) {
            this.logger.info(`Session auto-approve tools cleared for '${sessionId}'`);
        }
    }

    hasSessionUserAutoApproveTools(sessionId: string): boolean {
        return this.sessionUserAutoApproveTools.has(sessionId);
    }

    // ============= ENABLED/DISABLED TOOLS =============

    /**
     * Set global disabled tools (agent-level preferences).
     */
    setGlobalDisabledTools(toolNames: string[]): void {
        this.globalDisabledTools = [...toolNames];
        this.logger.info('Global disabled tools updated', {
            count: toolNames.length,
        });

        this.agentEventBus.emit('tools:enabled-updated', {
            scope: 'global',
            disabledTools: [...this.globalDisabledTools],
        });
    }

    getGlobalDisabledTools(): string[] {
        return [...this.globalDisabledTools];
    }

    /**
     * Set session-level disabled tools (overrides global list).
     */
    setSessionDisabledTools(sessionId: string, toolNames: string[]): void {
        if (toolNames.length === 0) {
            this.clearSessionDisabledTools(sessionId);
            return;
        }
        this.sessionDisabledTools.set(sessionId, [...toolNames]);
        this.logger.info('Session disabled tools updated', {
            sessionId,
            count: toolNames.length,
        });
        this.agentEventBus.emit('tools:enabled-updated', {
            scope: 'session',
            sessionId,
            disabledTools: [...toolNames],
        });
    }

    /**
     * Clear session-level disabled tools.
     */
    clearSessionDisabledTools(sessionId: string): void {
        const hadOverrides = this.sessionDisabledTools.has(sessionId);
        this.sessionDisabledTools.delete(sessionId);
        if (hadOverrides) {
            this.logger.info('Session disabled tools cleared', { sessionId });
        }
    }

    /**
     * Get disabled tools for a session (session override wins).
     */
    getDisabledTools(sessionId?: string): string[] {
        if (sessionId && this.sessionDisabledTools.has(sessionId)) {
            return this.sessionDisabledTools.get(sessionId) ?? [];
        }

        return this.globalDisabledTools;
    }

    /**
     * Filter a tool set based on disabled tools for a session.
     */
    filterToolsForSession(toolSet: ToolSet, sessionId?: string): ToolSet {
        const disabled = new Set(this.getDisabledTools(sessionId));
        if (disabled.size === 0) {
            return toolSet;
        }

        return Object.fromEntries(
            Object.entries(toolSet).filter(([toolName]) => !disabled.has(toolName))
        );
    }

    /**
     * Check if a session has auto-approve tools set.
     *
     * @param sessionId The session ID to check
     * @returns true if the session has auto-approve tools
     */
    hasSessionAutoApproveTools(sessionId: string): boolean {
        return this.sessionAutoApproveTools.has(sessionId);
    }

    /**
     * Get the auto-approve tools for a session (skill-provided list).
     *
     * @param sessionId The session ID to check
     * @returns Array of auto-approve tool names, or undefined if none set
     */
    getSessionAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionAutoApproveTools.get(sessionId);
    }

    /**
     * Get the user auto-approve tools for a session.
     */
    getSessionUserAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionUserAutoApproveTools.get(sessionId);
    }

    /**
     * Combined auto-approve list for a session.
     */
    getCombinedSessionAutoApproveTools(sessionId: string): string[] {
        return [
            ...(this.sessionAutoApproveTools.get(sessionId) ?? []),
            ...(this.sessionUserAutoApproveTools.get(sessionId) ?? []),
        ];
    }

    /**
     * Check if a tool should be auto-approved for a session.
     * Returns true if the tool is in the session's auto-approve list.
     *
     * @param sessionId The session ID
     * @param toolName The tool name to check
     * @returns true if the tool should be auto-approved
     */
    private isToolAutoApprovedForSession(sessionId: string, toolName: string): boolean {
        const autoApproveTools = this.getCombinedSessionAutoApproveTools(sessionId);
        if (autoApproveTools.length === 0) {
            return false;
        }
        // Check if tool matches any auto-approve pattern
        return autoApproveTools.some((pattern) => this.matchesToolPolicy(toolName, pattern));
    }

    /**
     * Invalidate the tools cache when tool sources change
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.toolsCache = {};
    }

    /**
     * Set up listeners for MCP notifications to invalidate cache on changes
     */
    private setupNotificationListeners(): void {
        // Listen for MCP server connection changes that affect tools
        this.agentEventBus.on('mcp:server-connected', async (payload) => {
            if (payload.success) {
                this.logger.debug(
                    `🔄 MCP server connected, invalidating tool cache: ${payload.name}`
                );
                this.invalidateCache();
            }
        });

        this.agentEventBus.on('mcp:server-removed', async (payload) => {
            this.logger.debug(
                `🔄 MCP server removed: ${payload.serverName}, invalidating tool cache`
            );
            this.invalidateCache();
        });

        // Auto-clear session auto-approve tools when a run completes
        // This ensures skill auto-approve tools don't persist beyond their intended scope
        this.agentEventBus.on('run:complete', (payload) => {
            if (this.hasSessionAutoApproveTools(payload.sessionId)) {
                this.logger.debug(
                    `🔓 Run complete, clearing session auto-approve tools for '${payload.sessionId}'`
                );
                this.clearSessionAutoApproveTools(payload.sessionId);
            }
        });
    }

    // ==================== Pattern Approval Helpers ====================

    private getToolApprovalPatternKeyFn(
        toolName: string
    ): ((args: Record<string, unknown>) => string | null) | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.approval?.patternKey;
    }

    private getToolSuggestApprovalPatternsFn(
        toolName: string
    ): ((args: Record<string, unknown>) => string[]) | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.approval?.suggestPatterns;
    }

    private getToolApprovalOverrideFn(
        toolName: string
    ):
        | ((
              args: Record<string, unknown>,
              context: ToolExecutionContext
          ) => Promise<ApprovalRequestDetails | null> | ApprovalRequestDetails | null)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.approval?.override;
    }

    private getToolApprovalOnGrantedFn(
        toolName: string
    ):
        | ((
              response: ApprovalResponse,
              context: ToolExecutionContext,
              approvalRequest: ApprovalRequestDetails
          ) => Promise<void> | void)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.approval?.onGranted;
    }

    private getToolPreviewFn(
        toolName: string
    ):
        | ((
              args: Record<string, unknown>,
              context: ToolExecutionContext
          ) => Promise<ToolDisplayData | null> | ToolDisplayData | null)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.presentation?.preview;
    }

    private getToolDescribeHeaderFn(
        toolName: string
    ):
        | ((
              args: Record<string, unknown>,
              context: ToolExecutionContext
          ) =>
              | Promise<ToolPresentationSnapshotV1['header'] | null>
              | ToolPresentationSnapshotV1['header']
              | null)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.presentation?.describeHeader;
    }

    private getToolDescribeArgsFn(
        toolName: string
    ):
        | ((
              args: Record<string, unknown>,
              context: ToolExecutionContext
          ) =>
              | Promise<ToolPresentationSnapshotV1['args'] | null>
              | ToolPresentationSnapshotV1['args']
              | null)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.presentation?.describeArgs;
    }

    private getToolDescribeResultFn(
        toolName: string
    ):
        | ((
              result: unknown,
              args: Record<string, unknown>,
              context: ToolExecutionContext
          ) =>
              | Promise<ToolPresentationSnapshotV1['result'] | null>
              | ToolPresentationSnapshotV1['result']
              | null)
        | undefined {
        const tool = this.agentTools.get(toolName);
        return tool?.presentation?.describeResult;
    }

    private buildGenericToolPresentationSnapshot(toolName: string): ToolPresentationSnapshotV1 {
        const toTitleCase = (name: string): string =>
            name
                .replace(/[_-]+/g, ' ')
                .split(' ')
                .filter(Boolean)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');

        const isMcp = toolName.startsWith(ToolManager.MCP_TOOL_PREFIX);
        const fallbackTitle = (() => {
            if (!isMcp) {
                return toTitleCase(toolName);
            }

            const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
            const parts = actualToolName.split('--');
            const toolPart = parts.length >= 2 ? parts.slice(1).join('--') : actualToolName;
            return toTitleCase(toolPart);
        })();

        const snapshot: ToolPresentationSnapshotV1 = {
            version: 1,
            source: {
                type: toolName.startsWith(ToolManager.MCP_TOOL_PREFIX) ? 'mcp' : 'local',
            },
            header: {
                title: fallbackTitle,
            },
        };

        if (snapshot.source?.type === 'mcp') {
            const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
            const parts = actualToolName.split('--');
            if (parts.length >= 2 && parts[0]) {
                snapshot.source.mcpServerName = parts[0];
            }
        }

        return snapshot;
    }

    private getToolPresentationSnapshotForToolCallEvent(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string
    ): ToolPresentationSnapshotV1 {
        const fallback = this.buildGenericToolPresentationSnapshot(toolName);

        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return fallback;
        }

        const describeHeader = this.getToolDescribeHeaderFn(toolName);
        const describeArgs = this.getToolDescribeArgsFn(toolName);
        if (!describeHeader && !describeArgs) {
            return fallback;
        }

        try {
            const validatedArgs = this.validateLocalToolArgs(toolName, args);
            const context = this.buildToolExecutionContext({ sessionId, toolCallId });

            const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
                if (typeof value !== 'object' || value === null) {
                    return false;
                }
                return typeof (value as { then?: unknown }).then === 'function';
            };

            let nextSnapshot: ToolPresentationSnapshotV1 = fallback;

            if (describeHeader) {
                const header = describeHeader(validatedArgs, context);
                if (!isPromiseLike(header) && header) {
                    nextSnapshot = {
                        ...nextSnapshot,
                        header: { ...nextSnapshot.header, ...header },
                    };
                }
            }

            if (describeArgs) {
                const argsPresentation = describeArgs(validatedArgs, context);
                if (!isPromiseLike(argsPresentation) && argsPresentation) {
                    nextSnapshot = {
                        ...nextSnapshot,
                        args: argsPresentation,
                    };
                }
            }

            return nextSnapshot;
        } catch (error) {
            this.logger.debug(
                `Tool presentation snapshot generation failed for '${toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return fallback;
        }
    }

    private async getToolPresentationSnapshotForCall(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string
    ): Promise<ToolPresentationSnapshotV1> {
        const fallback = this.buildGenericToolPresentationSnapshot(toolName);

        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return fallback;
        }

        const describeHeader = this.getToolDescribeHeaderFn(toolName);
        const describeArgs = this.getToolDescribeArgsFn(toolName);
        if (!describeHeader && !describeArgs) {
            return fallback;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId });
            const describedHeader = describeHeader
                ? await Promise.resolve(describeHeader(args, context))
                : null;
            const describedArgs = describeArgs
                ? await Promise.resolve(describeArgs(args, context))
                : null;

            return {
                ...fallback,
                ...(describedHeader ? { header: { ...fallback.header, ...describedHeader } } : {}),
                ...(describedArgs ? { args: describedArgs } : {}),
            };
        } catch (error) {
            this.logger.debug(
                `Tool presentation snapshot generation failed for '${toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return fallback;
        }
    }

    private async augmentSnapshotWithResult(
        toolName: string,
        snapshot: ToolPresentationSnapshotV1,
        result: unknown,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string
    ): Promise<ToolPresentationSnapshotV1> {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return snapshot;
        }

        const describeResult = this.getToolDescribeResultFn(toolName);
        if (!describeResult) {
            return snapshot;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId });
            const resultPresentation = await Promise.resolve(describeResult(result, args, context));
            if (!resultPresentation) {
                return snapshot;
            }
            return {
                ...snapshot,
                result: resultPresentation,
            };
        } catch (error) {
            this.logger.debug(
                `Tool result presentation snapshot generation failed for '${toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return snapshot;
        }
    }

    private getToolPatternKey(toolName: string, args: Record<string, unknown>): string | null {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return null;
        }

        const getPatternKey = this.getToolApprovalPatternKeyFn(toolName);
        if (!getPatternKey) {
            return null;
        }

        try {
            return getPatternKey(args);
        } catch (error) {
            this.logger.debug(
                `Pattern key generation failed for '${toolName}': ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }

    private getToolSuggestedPatterns(
        toolName: string,
        args: Record<string, unknown>
    ): string[] | undefined {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return undefined;
        }

        const suggestPatterns = this.getToolSuggestApprovalPatternsFn(toolName);
        if (!suggestPatterns) {
            return undefined;
        }

        try {
            const patterns = suggestPatterns(args);
            return patterns.length > 0 ? patterns : undefined;
        } catch (error) {
            this.logger.debug(
                `Pattern suggestion failed for '${toolName}': ${error instanceof Error ? error.message : String(error)}`
            );
            return undefined;
        }
    }

    /**
     * Auto-approve pending tool approval requests for the same tool.
     * Called after a user selects "remember choice" for a tool.
     * This handles the case where parallel tool calls come in before the first one is approved.
     *
     * @param toolName The tool name that was just remembered
     * @param sessionId The session ID for which the tool was allowed
     */
    private autoApprovePendingToolRequests(toolName: string, sessionId?: string): void {
        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                // Only match tool approval requests
                if (request.type !== ApprovalType.TOOL_APPROVAL) {
                    return false;
                }

                // Only match requests for the same session
                if (request.sessionId !== sessionId) {
                    return false;
                }

                // Check if it's the same tool
                return request.metadata.toolName === toolName;
            },
            { rememberChoice: false } // Don't propagate remember choice to auto-approved requests
        );

        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} parallel request(s) for tool '${toolName}' after user selected "remember choice"`
            );
        }
    }

    /**
     * Auto-approve pending tool approval requests that are now covered by a remembered pattern.
     * Called after a user selects "remember pattern" for a tool.
     */
    private autoApprovePendingPatternRequests(toolName: string, sessionId?: string): void {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return;
        }

        const getPatternKey = this.getToolApprovalPatternKeyFn(toolName);
        if (!getPatternKey) {
            return;
        }

        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                // Only match tool approval requests
                if (request.type !== ApprovalType.TOOL_APPROVAL) {
                    return false;
                }

                // Only match requests for the same session
                if (request.sessionId !== sessionId) {
                    return false;
                }

                if (request.metadata.toolName !== toolName) {
                    return false;
                }

                const args = request.metadata.args;
                if (typeof args !== 'object' || args === null) {
                    return false;
                }

                const argsRecord = args as Record<string, unknown>;

                let patternKey: string | null;
                try {
                    patternKey = getPatternKey(argsRecord);
                } catch (error) {
                    this.logger.debug(
                        `Pattern key generation failed for '${toolName}': ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                    return false;
                }
                if (!patternKey) return false;

                return this.approvalManager.matchesPattern(toolName, patternKey);
            },
            { rememberPattern: undefined } // Don't propagate pattern choice to auto-approved requests
        );

        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} parallel request(s) for tool '${toolName}' after user selected "remember pattern"`
            );
        }
    }

    getMcpManager(): MCPManager {
        return this.mcpManager;
    }

    setContributorContextFactory(factory?: DynamicContributorContextFactory | null): void {
        this.contributorContextFactory = factory ?? undefined;
    }

    async buildContributorContext(): Promise<DynamicContributorContext> {
        const baseWorkspace = this.currentWorkspace ?? null;
        const baseContext: DynamicContributorContext = {
            mcpManager: this.mcpManager,
            workspace: baseWorkspace,
        };

        if (!this.contributorContextFactory) {
            return baseContext;
        }

        try {
            const overrides = (await this.contributorContextFactory()) ?? {};
            const workspace =
                overrides.workspace !== undefined ? overrides.workspace : baseWorkspace;
            const environment =
                overrides.environment !== undefined
                    ? overrides.environment
                    : baseContext.environment;
            const mcpManager = overrides.mcpManager ?? baseContext.mcpManager;
            return {
                mcpManager,
                workspace,
                ...(environment !== undefined ? { environment } : {}),
            };
        } catch (error) {
            this.logger.warn(
                `Failed to build contributor context: ${error instanceof Error ? error.message : String(error)}`
            );
            return baseContext;
        }
    }

    /**
     * Get all MCP tools (delegates to mcpManager.getAllTools())
     * This provides access to MCP tools while maintaining separation of concerns
     */
    async getMcpTools(): Promise<ToolSet> {
        return await this.mcpManager.getAllTools();
    }

    private buildToolExecutionContext(options: {
        sessionId?: string | undefined;
        abortSignal?: AbortSignal | undefined;
        toolCallId?: string | undefined;
    }): ToolExecutionContext {
        const workspace = this.currentWorkspace;
        const baseContext: ToolExecutionContextBase = {
            sessionId: options.sessionId,
            workspaceId: workspace?.id,
            workspace,
            abortSignal: options.abortSignal,
            toolCallId: options.toolCallId,
            logger: this.logger,
        };
        return this.toolExecutionContextFactory(baseContext);
    }

    private validateLocalToolArgs(
        toolName: string,
        args: Record<string, unknown>
    ): Record<string, unknown> {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return args;
        }

        const tool = this.agentTools.get(toolName);
        if (!tool) {
            return args;
        }

        const validationResult = tool.inputSchema.safeParse(args);
        if (!validationResult.success) {
            this.logger.error(
                `❌ Invalid arguments for tool ${toolName}: ${validationResult.error.message}`
            );
            throw ToolError.validationFailed(
                toolName,
                `Invalid arguments: ${validationResult.error.message}`
            );
        }

        const validated = validationResult.data;
        // Most tools use z.object(...) schemas, so a successful parse should always yield an object.
        // Keep this guard defensively in case a tool uses a non-object schema.
        if (typeof validated !== 'object' || validated === null || Array.isArray(validated)) {
            throw ToolError.validationFailed(toolName, 'Invalid arguments: expected an object');
        }

        return validated as Record<string, unknown>;
    }

    private async executeLocalTool(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string,
        abortSignal?: AbortSignal,
        toolCallId?: string
    ): Promise<unknown> {
        const tool = this.agentTools.get(toolName);
        if (!tool) {
            this.logger.error(`❌ No local tool found: ${toolName}`);
            this.logger.debug(
                `Available local tools: ${Array.from(this.agentTools.keys()).join(', ')}`
            );
            throw ToolError.notFound(toolName);
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, abortSignal, toolCallId });
            const result = await tool.execute(args, context);
            return result;
        } catch (error) {
            this.logger.error(`❌ Local tool execution failed: ${toolName}`, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Build all tools from sources.
     *
     * TODO: Rethink MCP tool naming convention for more consistency.
     * Current issue: MCP tools have dynamic naming based on conflicts:
     * - No conflict: mcp--toolName
     * - With conflict: mcp--serverName--toolName
     * This makes policy configuration fragile. Consider:
     * 1. Always including server name: mcp--serverName--toolName (breaking change)
     * 2. Using a different delimiter pattern that's more predictable
     * 3. Providing a tool discovery command to help users find exact names
     * Related: Tool policies now support dual matching (exact + suffix) as a workaround
     */
    private async buildAllTools(): Promise<ToolSet> {
        const allTools: ToolSet = {};

        // Get tools from all sources (already in final JSON Schema format)
        let mcpTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            this.logger.error(
                `Failed to get MCP tools: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        // Add local tools
        for (const [toolName, tool] of this.agentTools) {
            allTools[toolName] = {
                name: toolName,
                description: tool.description || 'No description provided',
                parameters: wrapToolParametersSchema(
                    convertZodSchemaToJsonSchema(tool.inputSchema, this.logger)
                ),
            };
        }

        // Add MCP tools with 'mcp--' prefix
        for (const [toolName, toolDef] of Object.entries(mcpTools)) {
            const qualifiedName = `${ToolManager.MCP_TOOL_PREFIX}${toolName}`;
            allTools[qualifiedName] = {
                ...toolDef,
                name: qualifiedName,
                description: `${toolDef.description || 'No description provided'} (via MCP servers)`,
                parameters: wrapToolParametersSchema(toolDef.parameters),
            };
        }

        const totalTools = Object.keys(allTools).length;
        const mcpCount = Object.keys(mcpTools).length;
        const localCount = this.agentTools.size;

        this.logger.debug(
            `🔧 Unified tool discovery: ${totalTools} total tools (${mcpCount} MCP, ${localCount} local)`
        );

        return allTools;
    }

    /**
     * Get all available tools from all sources with conflict resolution
     * This is the single interface the LLM uses to discover tools
     * Uses caching to avoid rebuilding on every call
     */
    async getAllTools(): Promise<ToolSet> {
        if (this.cacheValid) {
            return this.toolsCache;
        }

        this.toolsCache = await this.buildAllTools();
        this.cacheValid = true;
        return this.toolsCache;
    }

    /**
     * Execute a tool by routing based on prefix:
     * - MCP tools: `mcp--...`
     * - Local tools: `Tool.id`
     *
     * @param toolName Tool name (e.g., "edit_file", "mcp--filesystem--read_file")
     * @param args The arguments for the tool
     * @param toolCallId The unique tool call ID for tracking (from LLM or generated for direct calls)
     * @param sessionId Optional session ID for context
     * @param abortSignal Optional abort signal for cancellation support
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string,
        abortSignal?: AbortSignal
    ): Promise<import('./types.js').ToolExecutionResult> {
        const { toolArgs: rawToolArgs, meta } = extractToolCallMeta(args);
        let toolArgs = rawToolArgs;
        const callDescription =
            typeof meta.callDescription === 'string'
                ? meta.callDescription
                : typeof rawToolArgs.description === 'string'
                  ? rawToolArgs.description
                  : undefined;
        const backgroundTasksEnabled = isBackgroundTasksEnabled();

        this.logger.debug(`🔧 Tool execution requested: '${toolName}' (toolCallId: ${toolCallId})`);
        this.logger.debug(`Tool args: ${JSON.stringify(toolArgs, null, 2)}`);

        // IMPORTANT: Emit llm:tool-call FIRST, before approval handling.
        // This ensures correct event ordering - llm:tool-call must arrive before approval:request
        // in the CLI's event stream.
        //
        // Why this is needed: The Vercel SDK enqueues tool-call to the stream BEFORE calling execute(),
        // but our async iterator hasn't read from the queue yet. Meanwhile, execute() runs synchronously
        // until its first await, and EventEmitter.emit() is synchronous. So events emitted here arrive
        // before our iterator processes the queued tool-call. By emitting here, we guarantee llm:tool-call
        // arrives before approval:request.
        if (sessionId) {
            const presentationSnapshot = this.getToolPresentationSnapshotForToolCallEvent(
                toolName,
                toolArgs,
                toolCallId,
                sessionId
            );
            this.agentEventBus.emit('llm:tool-call', {
                toolName,
                presentationSnapshot,
                args: toolArgs,
                ...(callDescription !== undefined && { callDescription }),
                callId: toolCallId,
                sessionId,
            });
        }

        // Handle approval/confirmation flow - returns whether approval was required
        const {
            requireApproval,
            approvalStatus,
            args: validatedToolArgs,
            presentationSnapshot: callSnapshot,
        } = await this.handleToolApproval(
            toolName,
            toolArgs,
            toolCallId,
            sessionId,
            callDescription
        );
        toolArgs = validatedToolArgs;

        this.logger.debug(`✅ Tool execution approved: ${toolName}`);
        this.logger.info(
            `🔧 Tool execution started for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        // Emit tool:running event - tool is now actually executing (after approval if needed)
        // Only emit when sessionId is provided (LLM flow) - direct API calls don't need UI updates
        if (sessionId) {
            this.agentEventBus.emit('tool:running', {
                toolName,
                toolCallId,
                sessionId,
            });
        }

        const startTime = Date.now();

        // Execute beforeToolCall hooks if available
        if (this.hookManager && this.sessionManager && this.stateManager) {
            const beforePayload: BeforeToolCallPayload = {
                toolName,
                args: toolArgs,
                ...(sessionId !== undefined && { sessionId }),
            };

            const modifiedPayload = await this.hookManager.executeHooks(
                'beforeToolCall',
                beforePayload,
                {
                    sessionManager: this.sessionManager,
                    mcpManager: this.mcpManager,
                    toolManager: this,
                    stateManager: this.stateManager,
                    ...(sessionId !== undefined && { sessionId }),
                }
            );

            // Use modified payload for execution
            toolArgs = modifiedPayload.args;

            // Hooks may modify tool args (including in-place). Re-validate before execution so tools
            // always receive schema-validated args and defaults/coercions are re-applied after hook mutation.
            try {
                toolArgs = this.validateLocalToolArgs(toolName, toolArgs);
            } catch (error) {
                this.logger.error(
                    `Post-hook validation failed for tool '${toolName}': a beforeToolCall hook may have set invalid args`
                );
                throw error;
            }
        }

        try {
            let result: unknown;

            const registerBackgroundTask = (promise: Promise<unknown>, description: string) => {
                const fallbackId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                return {
                    result: {
                        taskId: toolCallId ?? fallbackId,
                        status: 'running' as const,
                        description,
                    },
                    promise,
                };
            };

            // Route to MCP tools
            if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
                this.logger.debug(`🔧 Detected MCP tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                this.logger.debug(`🎯 MCP routing: '${toolName}' -> '${actualToolName}'`);

                const runInBackground =
                    backgroundTasksEnabled &&
                    meta.runInBackground === true &&
                    sessionId !== undefined;
                if (meta.runInBackground === true && !backgroundTasksEnabled) {
                    this.logger.debug(
                        'Background tool execution disabled; running synchronously instead.',
                        { toolName }
                    );
                }
                if (runInBackground) {
                    const backgroundSessionId = sessionId;
                    const { result: backgroundResult, promise } = registerBackgroundTask(
                        this.mcpManager.executeTool(actualToolName, toolArgs, backgroundSessionId),
                        `MCP tool ${actualToolName}`
                    );
                    this.agentEventBus.emit('tool:background', {
                        toolName,
                        toolCallId: backgroundResult.taskId,
                        sessionId: backgroundSessionId,
                        description: backgroundResult.description,
                        promise,
                        ...(meta.timeoutMs !== undefined && { timeoutMs: meta.timeoutMs }),
                        ...(meta.notifyOnComplete !== undefined && {
                            notifyOnComplete: meta.notifyOnComplete,
                        }),
                    });
                    result = backgroundResult;
                } else {
                    result = await this.mcpManager.executeTool(actualToolName, toolArgs, sessionId);
                }
            } else {
                // Route to local tools
                const runInBackground =
                    backgroundTasksEnabled &&
                    meta.runInBackground === true &&
                    sessionId !== undefined;
                if (meta.runInBackground === true && !backgroundTasksEnabled) {
                    this.logger.debug(
                        'Background tool execution disabled; running synchronously instead.',
                        { toolName }
                    );
                }

                if (runInBackground) {
                    const backgroundSessionId = sessionId;
                    const { result: backgroundResult, promise } = registerBackgroundTask(
                        this.executeLocalTool(
                            toolName,
                            toolArgs,
                            backgroundSessionId,
                            abortSignal,
                            toolCallId
                        ),
                        `Tool ${toolName}`
                    );
                    this.agentEventBus.emit('tool:background', {
                        toolName,
                        toolCallId: backgroundResult.taskId,
                        sessionId: backgroundSessionId,
                        description: backgroundResult.description,
                        promise,
                        ...(meta.timeoutMs !== undefined && { timeoutMs: meta.timeoutMs }),
                        ...(meta.notifyOnComplete !== undefined && {
                            notifyOnComplete: meta.notifyOnComplete,
                        }),
                    });
                    result = backgroundResult;
                } else {
                    result = await this.executeLocalTool(
                        toolName,
                        toolArgs,
                        sessionId,
                        abortSignal,
                        toolCallId
                    );
                }
            }

            const duration = Date.now() - startTime;
            this.logger.debug(`🎯 Tool execution completed in ${duration}ms: '${toolName}'`);
            this.logger.info(
                `✅ Tool execution completed successfully for ${toolName} in ${duration}ms, sessionId: ${sessionId ?? 'global'}`
            );

            // Execute afterToolResult hooks if available
            if (this.hookManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName,
                    result,
                    success: true,
                    ...(sessionId !== undefined && { sessionId }),
                };

                const modifiedPayload = await this.hookManager.executeHooks(
                    'afterToolResult',
                    afterPayload,
                    {
                        sessionManager: this.sessionManager,
                        mcpManager: this.mcpManager,
                        toolManager: this,
                        stateManager: this.stateManager,
                        ...(sessionId !== undefined && { sessionId }),
                    }
                );

                // Use modified result
                result = modifiedPayload.result;
            }

            const presentationSnapshot = await this.augmentSnapshotWithResult(
                toolName,
                callSnapshot,
                result,
                toolArgs,
                toolCallId,
                sessionId
            );

            return {
                result,
                ...(presentationSnapshot !== undefined && { presentationSnapshot }),
                ...(requireApproval && { requireApproval, approvalStatus }),
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error(
                `❌ Tool execution failed for ${toolName} after ${duration}ms, sessionId: ${sessionId ?? 'global'}: ${error instanceof Error ? error.message : String(error)}`
            );

            // Execute afterToolResult hooks for error case if available
            if (this.hookManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName,
                    result: error instanceof Error ? error.message : String(error),
                    success: false,
                    ...(sessionId !== undefined && { sessionId }),
                };

                // Note: We still execute hooks even on error, but we don't use the modified result.
                // Hooks can log, track metrics, etc. but cannot suppress the error.
                await this.hookManager.executeHooks('afterToolResult', afterPayload, {
                    sessionManager: this.sessionManager,
                    mcpManager: this.mcpManager,
                    toolManager: this,
                    stateManager: this.stateManager,
                    ...(sessionId !== undefined && { sessionId }),
                });
            }

            throw error;
        }
    }

    /**
     * Check if a tool exists.
     */
    async hasTool(toolName: string): Promise<boolean> {
        // Check MCP tools
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
            return this.mcpManager.getToolClient(actualToolName) !== undefined;
        }

        // Local tools use their ids as-is.
        return this.agentTools.has(toolName);
    }

    /**
     * Get tool statistics across all sources
     */
    async getToolStats(): Promise<{
        total: number;
        mcp: number;
        local: number;
    }> {
        let mcpTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            this.logger.error(
                `Failed to get MCP tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        const mcpCount = Object.keys(mcpTools).length;
        const localCount = this.agentTools.size;

        return {
            total: mcpCount + localCount,
            mcp: mcpCount,
            local: localCount,
        };
    }

    /**
     * Get the source of a tool (mcp, local, or unknown).
     * @param toolName The name of the tool to check
     * @returns The source of the tool
     */
    getToolSource(toolName: string): 'mcp' | 'local' | 'unknown' {
        if (
            toolName.startsWith(ToolManager.MCP_TOOL_PREFIX) &&
            toolName.length > ToolManager.MCP_TOOL_PREFIX.length
        ) {
            return 'mcp';
        }

        if (this.agentTools.has(toolName)) {
            return 'local';
        }

        return 'unknown';
    }

    /**
     * Check if a tool matches a policy pattern
     * Supports both exact matching and suffix matching for MCP tools with server prefixes
     *
     * Examples:
     * - Policy "mcp--read_file" matches "mcp--read_file" (exact)
     * - Policy "mcp--read_file" matches "mcp--filesystem--read_file" (suffix)
     * - Policy "read_file" matches "read_file" (local tool exact only)
     *
     * @param toolName The fully qualified tool name (e.g., "mcp--filesystem--read_file")
     * @param policyPattern The policy pattern to match against (e.g., "mcp--read_file")
     * @returns true if the tool matches the policy pattern
     */
    private matchesToolPolicy(toolName: string, policyPattern: string): boolean {
        // Exact match
        if (toolName === policyPattern) {
            return true;
        }

        // Suffix match for MCP tools with server conflicts
        // Policy "mcp--read_file" should match "mcp--filesystem--read_file"
        // Note: MCP server delimiter is '--' (defined in MCPManager.SERVER_DELIMITER)
        if (policyPattern.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            // Extract the base tool name without mcp-- prefix
            const baseName = policyPattern.substring(ToolManager.MCP_TOOL_PREFIX.length);

            // Check if the tool name ends with --{baseName} and starts with mcp--
            // This handles: mcp--filesystem--read_file matching policy mcp--read_file
            if (
                toolName.endsWith(`--${baseName}`) &&
                toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a tool is in the static alwaysDeny list
     * Supports both exact and suffix matching (e.g., "mcp--read_file" matches "mcp--server--read_file")
     * @param toolName The fully qualified tool name to check
     * @returns true if the tool is in the deny list
     */
    private isInAlwaysDenyList(toolName: string): boolean {
        if (!this.toolPolicies?.alwaysDeny) {
            return false;
        }
        return this.toolPolicies.alwaysDeny.some((pattern) =>
            this.matchesToolPolicy(toolName, pattern)
        );
    }

    /**
     * Check if a tool is in the static alwaysAllow list
     * Supports both exact and suffix matching (e.g., "mcp--read_file" matches "mcp--server--read_file")
     * @param toolName The fully qualified tool name to check
     * @returns true if the tool is in the allow list
     */
    private isInAlwaysAllowList(toolName: string): boolean {
        if (!this.toolPolicies?.alwaysAllow) {
            return false;
        }
        return this.toolPolicies.alwaysAllow.some((pattern) =>
            this.matchesToolPolicy(toolName, pattern)
        );
    }

    /**
     * Handle tool approval flow. Checks various precedence levels to determine
     * if a tool should be auto-approved, denied, or requires manual approval.
     */
    private async handleToolApproval(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string,
        callDescription?: string
    ): Promise<{
        requireApproval: boolean;
        approvalStatus?: 'approved' | 'rejected';
        args: Record<string, unknown>;
        presentationSnapshot: ToolPresentationSnapshotV1;
    }> {
        // 1. Check static alwaysDeny list (highest priority - security-first)
        if (this.isInAlwaysDenyList(toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in static deny list – blocking execution (session: ${sessionId ?? 'global'})`
            );
            throw ToolError.executionDenied(toolName, sessionId);
        }

        const validatedArgs = this.validateLocalToolArgs(toolName, args);
        const presentationSnapshot = await this.getToolPresentationSnapshotForCall(
            toolName,
            validatedArgs,
            toolCallId,
            sessionId
        );

        // 2. Tool-specific approval override (directory access and other custom approvals)
        let directoryAccess: DirectoryAccessMetadata | undefined;
        let directoryAccessApprovalRequest: ApprovalRequestDetails | undefined;

        if (!toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            const getApprovalOverride = this.getToolApprovalOverrideFn(toolName);
            if (getApprovalOverride) {
                const context = this.buildToolExecutionContext({ sessionId, toolCallId });
                const approvalRequest = await getApprovalOverride(validatedArgs, context);

                if (approvalRequest) {
                    // Directory access is handled via the normal tool approval UI so we can show
                    // tool previews/diffs (directory session choice is presented as an extra option).
                    if (approvalRequest.type === ApprovalType.DIRECTORY_ACCESS) {
                        const metadata = approvalRequest.metadata;
                        if (
                            typeof metadata !== 'object' ||
                            metadata === null ||
                            typeof (metadata as DirectoryAccessMetadata).path !== 'string' ||
                            typeof (metadata as DirectoryAccessMetadata).parentDir !== 'string' ||
                            typeof (metadata as DirectoryAccessMetadata).operation !== 'string' ||
                            typeof (metadata as DirectoryAccessMetadata).toolName !== 'string'
                        ) {
                            throw ToolError.configInvalid(
                                `Tool '${toolName}' returned invalid directory access metadata`
                            );
                        }

                        directoryAccess = metadata as DirectoryAccessMetadata;
                        directoryAccessApprovalRequest = approvalRequest;
                    } else {
                        this.logger.debug(
                            `Tool '${toolName}' requested custom approval: type=${approvalRequest.type}`
                        );

                        // Add sessionId to the approval request if not already present
                        if (sessionId && !approvalRequest.sessionId) {
                            approvalRequest.sessionId = sessionId;
                        }

                        const response =
                            await this.approvalManager.requestApproval(approvalRequest);

                        if (response.status === ApprovalStatus.APPROVED) {
                            const onGranted = this.getToolApprovalOnGrantedFn(toolName);
                            if (onGranted) {
                                await Promise.resolve(
                                    onGranted(response, context, approvalRequest)
                                );
                            }

                            this.logger.info(
                                `Custom approval granted for '${toolName}', type=${approvalRequest.type}, session=${sessionId ?? 'global'}`
                            );
                            return {
                                requireApproval: true,
                                approvalStatus: 'approved',
                                args: validatedArgs,
                                presentationSnapshot,
                            };
                        }

                        // Handle denial - throw appropriate error based on approval type
                        this.logger.info(
                            `Custom approval denied for '${toolName}', type=${approvalRequest.type}, reason=${response.reason ?? 'unknown'}`
                        );

                        throw ToolError.executionDenied(toolName, sessionId);
                    }
                }
            }
        }

        // Try quick resolution first (auto-approve/deny based on policies)
        const quickResult = await this.tryQuickApprovalResolution(
            toolName,
            validatedArgs,
            sessionId,
            directoryAccess
        );
        if (quickResult !== null) {
            return { ...quickResult, args: validatedArgs, presentationSnapshot };
        }

        // Fall back to manual approval flow
        const manualResult = await this.requestManualApproval(
            toolName,
            validatedArgs,
            toolCallId,
            sessionId,
            directoryAccess,
            directoryAccessApprovalRequest,
            callDescription,
            presentationSnapshot
        );
        return { ...manualResult, args: validatedArgs, presentationSnapshot };
    }

    /**
     * Try to resolve tool approval quickly based on policies and cached permissions.
     * Returns null if manual approval is needed.
     *
     * Precedence order (highest to lowest):
     * 1. Directory access requirement (outside-root paths)
     * 2. Session auto-approve (skill allowed-tools)
     * 3. Static allow list
     * 4. Dynamic "remembered" allowed list
     * 5. Tool approval patterns
     * 6. Approval mode (auto-approve/auto-deny)
     */
    private async tryQuickApprovalResolution(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string,
        directoryAccess?: DirectoryAccessMetadata
    ): Promise<{ requireApproval: boolean; approvalStatus?: 'approved' } | null> {
        // 2. Directory access: require explicit tool approval unless the directory is already session-approved.
        // This bypasses remembered-tool approvals and edit-mode auto-approvals for outside-root paths.
        if (directoryAccess) {
            if (this.approvalMode === 'auto-approve') {
                this.approvalManager.addApprovedDirectory(directoryAccess.parentDir, 'once');
                return { requireApproval: false };
            }
            return null;
        }

        // 3. Check session auto-approve (skill allowed-tools)
        if (sessionId && this.isToolAutoApprovedForSession(sessionId, toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in session's auto-approve list – skipping confirmation (session: ${sessionId})`
            );
            return { requireApproval: false };
        }

        // 4. Check static alwaysAllow list
        if (this.isInAlwaysAllowList(toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in static allow list – skipping confirmation (session: ${sessionId ?? 'global'})`
            );
            return { requireApproval: false };
        }

        // 5. Check dynamic "remembered" allowed list
        if (await this.allowedToolsProvider.isToolAllowed(toolName, sessionId)) {
            this.logger.info(
                `Tool '${toolName}' already allowed for session '${sessionId ?? 'global'}' – skipping confirmation.`
            );
            return { requireApproval: false };
        }

        // 6. Check tool approval patterns
        const patternKey = this.getToolPatternKey(toolName, args);
        if (patternKey && this.approvalManager.matchesPattern(toolName, patternKey)) {
            this.logger.info(
                `Tool '${toolName}' matched approved pattern key '${patternKey}' – skipping confirmation.`
            );
            return { requireApproval: false };
        }

        // 7. Check approval mode
        if (this.approvalMode === 'auto-approve') {
            this.logger.debug(`🟢 Auto-approving tool execution: ${toolName}`);
            return { requireApproval: false };
        }

        if (this.approvalMode === 'auto-deny') {
            this.logger.debug(`🚫 Auto-denying tool execution: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // Needs manual approval
        return null;
    }

    /**
     * Request manual approval from the user for a tool execution.
     * Generates preview, sends approval request, and handles the response.
     */
    private async requestManualApproval(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string,
        directoryAccess?: DirectoryAccessMetadata,
        directoryAccessApprovalRequest?: ApprovalRequestDetails,
        callDescription?: string,
        presentationSnapshot?: ToolPresentationSnapshotV1
    ): Promise<{ requireApproval: boolean; approvalStatus: 'approved' | 'rejected' }> {
        this.logger.info(
            `Tool approval requested for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        try {
            // Generate preview for approval UI
            const displayPreview = await this.generateToolPreview(
                toolName,
                args,
                toolCallId,
                sessionId
            );

            // Get suggested patterns if applicable
            const suggestedPatterns = this.getToolSuggestedPatterns(toolName, args);

            // Build and send approval request
            const response = await this.approvalManager.requestToolApproval({
                toolName,
                ...(presentationSnapshot !== undefined && { presentationSnapshot }),
                toolCallId,
                args,
                ...(callDescription !== undefined && { description: callDescription }),
                ...(sessionId !== undefined && { sessionId }),
                ...(displayPreview !== undefined && { displayPreview }),
                ...(directoryAccess !== undefined && { directoryAccess }),
                ...(suggestedPatterns !== undefined && { suggestedPatterns }),
            });

            // Let tools handle approval responses (e.g., remember directory)
            if (
                response.status === ApprovalStatus.APPROVED &&
                directoryAccessApprovalRequest !== undefined
            ) {
                const onGranted = this.getToolApprovalOnGrantedFn(toolName);
                if (onGranted) {
                    const context = this.buildToolExecutionContext({ sessionId, toolCallId });
                    await Promise.resolve(
                        onGranted(response, context, directoryAccessApprovalRequest)
                    );
                }
            }

            // Handle "remember" choices if approved
            if (response.status === ApprovalStatus.APPROVED && response.data) {
                await this.handleRememberChoice(toolName, response, sessionId);
            }

            // Process response
            if (response.status !== ApprovalStatus.APPROVED) {
                this.handleApprovalDenied(toolName, response, sessionId);
            }

            this.logger.info(
                `Tool approval approved for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );
            return { requireApproval: true, approvalStatus: 'approved' };
        } catch (error) {
            this.logger.error(
                `Tool approval error for ${toolName}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Generate a preview for the tool approval UI if the tool supports it.
     */
    private async generateToolPreview(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string
    ): Promise<ToolDisplayData | undefined> {
        const previewFn = this.getToolPreviewFn(toolName);
        if (!previewFn) {
            return undefined;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId });
            const preview = await previewFn(args, context);
            this.logger.debug(`Generated preview for ${toolName}`);
            return preview ?? undefined;
        } catch (previewError) {
            // Validation errors should fail before approval
            if (
                previewError instanceof DextoRuntimeError &&
                previewError.code === ToolErrorCode.VALIDATION_FAILED
            ) {
                this.logger.debug(`Validation failed for ${toolName}: ${previewError.message}`);
                throw previewError;
            }
            // Other errors should not block approval
            this.logger.debug(
                `Preview generation failed for ${toolName}: ${previewError instanceof Error ? previewError.message : String(previewError)}`
            );
            return undefined;
        }
    }

    /**
     * Handle "remember choice" or "remember pattern" when user approves a tool.
     */
    private async handleRememberChoice(
        toolName: string,
        response: { status: ApprovalStatus; data?: unknown; sessionId?: string | undefined },
        sessionId?: string
    ): Promise<void> {
        const data = response.data as Record<string, unknown> | undefined;
        if (!data) return;

        const rememberChoice = data.rememberChoice as boolean | undefined;
        const rememberPattern = data.rememberPattern as string | undefined;

        if (rememberChoice) {
            const allowSessionId = sessionId ?? response.sessionId;
            await this.allowedToolsProvider.allowTool(toolName, allowSessionId);
            this.logger.info(
                `Tool '${toolName}' added to allowed tools for session '${allowSessionId ?? 'global'}' (remember choice selected)`
            );
            this.autoApprovePendingToolRequests(toolName, allowSessionId);
        } else if (rememberPattern && this.getToolApprovalPatternKeyFn(toolName)) {
            this.approvalManager.addPattern(toolName, rememberPattern);
            this.logger.info(`Pattern '${rememberPattern}' added for tool '${toolName}' approval`);
            this.autoApprovePendingPatternRequests(toolName, sessionId);
        }
    }

    /**
     * Handle approval denied/timeout - throws appropriate error.
     */
    private handleApprovalDenied(
        toolName: string,
        response: {
            status: ApprovalStatus;
            reason?: DenialReason | undefined;
            message?: string | undefined;
            timeoutMs?: number | undefined;
        },
        sessionId?: string
    ): never {
        if (
            response.status === ApprovalStatus.CANCELLED &&
            response.reason === DenialReason.TIMEOUT
        ) {
            this.logger.info(
                `Tool confirmation timed out for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );
            throw ToolError.executionTimeout(toolName, response.timeoutMs ?? 0, sessionId);
        }

        this.logger.info(
            `Tool confirmation denied for ${toolName}, sessionId: ${sessionId ?? 'global'}, reason: ${response.reason ?? 'unknown'}`
        );
        throw ToolError.executionDenied(toolName, sessionId, response.message);
    }

    /**
     * Refresh tool discovery (call when MCP servers change)
     * Refreshes both MCPManager's cache (server capabilities) and ToolManager's cache (combined tools)
     */
    async refresh(): Promise<void> {
        // First: Refresh MCPManager's cache to get fresh data from MCP servers
        await this.mcpManager.refresh();

        // Then: Invalidate our cache so next getAllTools() rebuilds from fresh MCP data
        this.invalidateCache();

        this.logger.debug('ToolManager refreshed (including MCP server capabilities)');
    }

    /**
     * Get list of pending confirmation requests
     */
    getPendingConfirmations(): string[] {
        return this.approvalManager.getPendingApprovals();
    }

    /**
     * Cancel a pending confirmation request
     */
    cancelConfirmation(approvalId: string): void {
        this.approvalManager.cancelApproval(approvalId);
    }

    /**
     * Cancel all pending confirmation requests
     */
    cancelAllConfirmations(): void {
        this.approvalManager.cancelAllApprovals();
    }
}
