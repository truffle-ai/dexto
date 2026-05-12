import { isDeepStrictEqual } from 'node:util';
import { MCPManager } from '../mcp/manager.js';
import type { ToolPolicies } from './schemas.js';
import {
    ToolSet,
    ToolExecutionContext,
    ToolExecutionContextBase,
    Tool,
    ToolPresentationSnapshotV1,
    ToolExecutionResult,
} from './types.js';
import type { ToolDisplayData } from './display-types.js';
import { ToolError } from './errors.js';
import { ToolErrorCode } from './error-codes.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { convertZodSchemaToJsonSchema } from '../utils/schema.js';
import type { AgentEventBus } from '../events/index.js';
import type {
    ApprovalDecisionInput,
    ApprovalManager,
    ApprovalRecordIdentity,
} from '../approval/manager.js';
import { ApprovalStatus, ApprovalType, DenialReason } from '../approval/types.js';
import type {
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    DirectoryAccessMetadata,
} from '../approval/types.js';
import { DirectoryAccessMetadataSchema } from '../approval/schemas.js';
import type { AllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../hooks/types.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { WorkspaceContext } from '../workspace/types.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import type {
    SessionToolPreferences,
    SessionToolPreferencesStore,
} from './session-tool-preferences-store.js';
import type {
    ToolExecutionIdentity,
    ToolExecutionRecord,
    ToolExecutionStore,
} from '../storage/tool-executions/types.js';
import {
    completedToolExecutionToResult,
    createToolExecutionId,
} from '../storage/tool-executions/types.js';
import {
    extractToolCallMeta,
    wrapToolParametersSchema,
    type ToolCallMetadata,
} from './tool-call-metadata.js';
import { isBackgroundTasksEnabled } from '../utils/env.js';
import type {
    DynamicContributorContext,
    DynamicContributorContextFactory,
} from '../systemPrompt/types.js';
import type { AgentRunContext } from '../runtime/run-context.js';

export type ToolExecutionContextFactory = (
    baseContext: ToolExecutionContextBase
) => ToolExecutionContext;

type ToolExecutionInvocation = {
    sessionId?: string | undefined;
    abortSignal?: AbortSignal | undefined;
    runContext?: AgentRunContext | undefined;
    executionIdentity?: ToolExecutionIdentity | undefined;
};

export type ExecutableToolCall = {
    approval?: {
        approvalStatus: 'approved';
        requireApproval: true;
    };
    callDescription?: string;
    input: Record<string, unknown>;
    meta?: ToolCallMetadata;
    presentationSnapshot: ToolPresentationSnapshotV1;
    source: 'local' | 'mcp';
    toolCallId: string;
    toolName: string;
};

export type PreparedToolCall =
    | {
          kind: 'ready';
          call: ExecutableToolCall;
      }
    | {
          kind: 'approval-required';
          call: ExecutableToolCall;
          onGrantedRequestDetails: ApprovalRequestDetails;
          requestDetails: ApprovalRequestDetails;
      }
    | {
          kind: 'terminal';
          reason: 'denied';
          call: ExecutableToolCall;
          modelVisibleResult: ToolExecutionResult;
      }
    | {
          kind: 'terminal';
          reason: 'invalid-input' | 'unknown-tool';
          modelVisibleResult: ToolExecutionResult;
      };

export type ApprovalRequiredPreparedToolCall = Extract<
    PreparedToolCall,
    { kind: 'approval-required' }
>;

export type ToolApprovalRecordIdentity = Omit<ApprovalRecordIdentity, 'toolCallId'>;

export type RecordedToolApproval = {
    prepared: ApprovalRequiredPreparedToolCall;
    request: ApprovalRequest;
};

export type ToolApprovalDecisionApplication =
    | {
          kind: 'ready';
          call: ExecutableToolCall;
          response: ApprovalResponse;
      }
    | {
          kind: 'terminal';
          modelVisibleResult: ToolExecutionResult;
          response: ApprovalResponse;
      };

export type PrepareToolCallInput = {
    toolName: string;
    input: unknown;
    toolCallId: string;
    sessionId?: string | undefined;
    runContext?: AgentRunContext | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
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
 * LLM runtime → ToolManager → [MCPManager, local tools]
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

    // Session-level auto-approve tools set by runtime callers.
    // This is ADDITIVE - other tools are NOT blocked, they just go through normal approval flow.
    private sessionAutoApproveTools: Map<string, string[]> = new Map();
    // Session-level auto-approve tools set by users (UI)
    private sessionUserAutoApproveTools: Map<string, string[]> = new Map();
    private sessionDisabledTools: Map<string, string[]> = new Map();
    private readonly restoredSessionPreferences = new Set<string>();
    private readonly sessionPreferenceLocks = new Map<string, Promise<void>>();
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
        logger: Logger,
        private readonly sessionToolPreferencesStore: SessionToolPreferencesStore,
        private readonly toolExecutionStore: ToolExecutionStore
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

    private async runWithSessionPreferenceLock<T>(
        sessionId: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const previousLock = this.sessionPreferenceLocks.get(sessionId) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn());
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.sessionPreferenceLocks.set(sessionId, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.sessionPreferenceLocks.get(sessionId) === currentLock) {
                this.sessionPreferenceLocks.delete(sessionId);
            }
        }
    }

    private applySessionToolPreferences(
        sessionId: string,
        preferences: SessionToolPreferences
    ): void {
        if (preferences.userAutoApproveTools.length > 0) {
            this.sessionUserAutoApproveTools.set(sessionId, [...preferences.userAutoApproveTools]);
        } else {
            this.sessionUserAutoApproveTools.delete(sessionId);
        }
        if (preferences.disabledTools.length > 0) {
            this.sessionDisabledTools.set(sessionId, [...preferences.disabledTools]);
        } else {
            this.sessionDisabledTools.delete(sessionId);
        }
    }

    private getSessionToolPreferencesSnapshot(sessionId: string): SessionToolPreferences {
        return {
            userAutoApproveTools: [...(this.sessionUserAutoApproveTools.get(sessionId) ?? [])],
            disabledTools: [...(this.sessionDisabledTools.get(sessionId) ?? [])],
        };
    }

    async restoreSessionState(sessionId: string): Promise<void> {
        if (this.restoredSessionPreferences.has(sessionId)) {
            return;
        }

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            if (this.restoredSessionPreferences.has(sessionId)) {
                return;
            }

            const preferences = await this.sessionToolPreferencesStore.load(sessionId);
            this.applySessionToolPreferences(sessionId, preferences);
            this.restoredSessionPreferences.add(sessionId);

            this.logger.debug('Restored persisted session tool preferences', {
                sessionId,
                autoApproveCount: preferences.userAutoApproveTools.length,
                disabledCount: preferences.disabledTools.length,
            });
        });
    }

    evictSessionState(sessionId: string): void {
        this.sessionAutoApproveTools.delete(sessionId);
        this.sessionUserAutoApproveTools.delete(sessionId);
        this.sessionDisabledTools.delete(sessionId);
        this.restoredSessionPreferences.delete(sessionId);
    }

    async deleteSessionState(sessionId: string): Promise<void> {
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.evictSessionState(sessionId);
            await this.sessionToolPreferencesStore.delete(sessionId);
        });
    }

    private async persistSessionToolPreferences(sessionId: string): Promise<void> {
        await this.sessionToolPreferencesStore.save(
            sessionId,
            this.getSessionToolPreferencesSnapshot(sessionId)
        );
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
    async setWorkspaceManager(workspaceManager: WorkspaceManager): Promise<void> {
        this.workspaceManager = workspaceManager;

        if (!this.workspaceListenerAttached) {
            this.workspaceListenerAttached = true;
            this.agentEventBus.on(
                'workspace:changed',
                (payload) => {
                    this.currentWorkspace = payload.workspace ?? undefined;
                    this.invalidateCache();
                },
                { signal: this.workspaceListenerAbort.signal }
            );
            this.registerCleanup(() => {
                if (!this.workspaceListenerAbort.signal.aborted) {
                    this.workspaceListenerAbort.abort();
                }
            });
        }

        await this.refreshWorkspace();
        this.logger.debug('WorkspaceManager reference configured for ToolManager');
    }

    private async refreshWorkspace(): Promise<void> {
        if (!this.workspaceManager) {
            return;
        }

        try {
            const previousWorkspacePath = this.currentWorkspace?.path;
            this.currentWorkspace = await this.workspaceManager.getWorkspace();
            if (previousWorkspacePath !== this.currentWorkspace?.path) {
                this.invalidateCache();
            }
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

        const actuallyAdded = Math.max(0, merged.length - existing.length);
        this.sessionAutoApproveTools.set(sessionId, merged);
        this.logger.info(
            `Session auto-approve tools updated for '${sessionId}': +${actuallyAdded} tools`
        );
        this.logger.debug(`Auto-approve tools: ${merged.join(', ')}`);
    }

    /**
     * Set session-level auto-approve tools chosen by the user.
     */
    async setSessionUserAutoApproveTools(
        sessionId: string,
        autoApproveTools: string[]
    ): Promise<void> {
        await this.restoreSessionState(sessionId);
        if (autoApproveTools.length === 0) {
            await this.clearSessionUserAutoApproveTools(sessionId);
            return;
        }

        const normalized = autoApproveTools.map((pattern) =>
            this.normalizeToolPolicyPattern(pattern)
        );

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.sessionUserAutoApproveTools.set(sessionId, normalized);
            await this.persistSessionToolPreferences(sessionId);
        });

        this.logger.info(
            `Session user auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`User auto-approve tools: ${normalized.join(', ')}`);
    }

    /**
     * Clear session-level auto-approve tools chosen by the user.
     */
    async clearSessionUserAutoApproveTools(sessionId: string): Promise<void> {
        await this.restoreSessionState(sessionId);

        let hadAutoApprove = false;
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            hadAutoApprove = this.sessionUserAutoApproveTools.has(sessionId);
            this.sessionUserAutoApproveTools.delete(sessionId);
            await this.persistSessionToolPreferences(sessionId);
        });

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
    async setSessionDisabledTools(sessionId: string, toolNames: string[]): Promise<void> {
        await this.restoreSessionState(sessionId);
        if (toolNames.length === 0) {
            await this.clearSessionDisabledTools(sessionId);
            return;
        }

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.sessionDisabledTools.set(sessionId, [...toolNames]);
            await this.persistSessionToolPreferences(sessionId);
        });

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
    async clearSessionDisabledTools(sessionId: string): Promise<void> {
        await this.restoreSessionState(sessionId);

        let hadOverrides = false;
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            hadOverrides = this.sessionDisabledTools.has(sessionId);
            this.sessionDisabledTools.delete(sessionId);
            await this.persistSessionToolPreferences(sessionId);
        });

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

    private async refreshDynamicToolDescriptions(): Promise<void> {
        if (!this.cacheValid) {
            return;
        }

        for (const [toolName, tool] of this.agentTools) {
            if (!tool.getDescription) {
                continue;
            }

            const cachedTool = this.toolsCache[toolName];
            if (!cachedTool) {
                continue;
            }

            try {
                const fallbackDescription = tool.description.trim() ? tool.description : '';
                const dynamicDescription = await tool.getDescription(
                    this.buildToolExecutionContext({})
                );
                cachedTool.description = dynamicDescription.trim()
                    ? dynamicDescription
                    : fallbackDescription;
            } catch (error) {
                this.logger.warn(
                    `Failed to refresh dynamic description for '${toolName}': ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }
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
        sessionId?: string,
        runContext?: AgentRunContext
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
            const context = this.buildToolExecutionContext({ sessionId, toolCallId, runContext });

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
        sessionId?: string,
        runContext?: AgentRunContext
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
            const context = this.buildToolExecutionContext({ sessionId, toolCallId, runContext });
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
        sessionId?: string,
        runContext?: AgentRunContext
    ): Promise<ToolPresentationSnapshotV1> {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return snapshot;
        }

        const describeResult = this.getToolDescribeResultFn(toolName);
        if (!describeResult) {
            return snapshot;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId, runContext });
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
                if (request.metadata.toolName !== toolName) {
                    return false;
                }

                // Never auto-approve directory access prompts due to remembered tool approvals.
                // Directory access approvals are higher priority and should be explicitly granted.
                return request.metadata.directoryAccess === undefined;
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

                // Never auto-approve directory access prompts due to remembered patterns.
                // Directory access approvals are higher priority and should be explicitly granted.
                if (request.metadata.directoryAccess !== undefined) {
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

                return this.approvalManager.matchesPattern(toolName, patternKey, sessionId);
            },
            { rememberPattern: undefined } // Don't propagate pattern choice to auto-approved requests
        );

        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} parallel request(s) for tool '${toolName}' after user selected "remember pattern"`
            );
        }
    }

    /**
     * Auto-approve pending tool approval requests that are now covered by a remembered directory.
     * Called after a user selects "remember directory" for a directory-access prompt.
     */
    private autoApprovePendingDirectoryRequests(toolName: string, sessionId?: string): void {
        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                if (request.type !== ApprovalType.TOOL_APPROVAL) {
                    return false;
                }

                if (request.sessionId !== sessionId) {
                    return false;
                }

                if (request.metadata.toolName !== toolName) {
                    return false;
                }

                const directoryAccess = request.metadata.directoryAccess;
                if (!directoryAccess) {
                    return false;
                }

                return this.approvalManager.isDirectorySessionApproved(
                    directoryAccess.parentDir,
                    sessionId
                );
            },
            { rememberDirectory: false }
        );

        if (count > 0) {
            this.logger.info(
                'Auto-approved parallel request(s) after user selected "remember directory"',
                { count, toolName }
            );
        }
    }

    getMcpManager(): MCPManager {
        return this.mcpManager;
    }

    setContributorContextFactory(factory?: DynamicContributorContextFactory | null): void {
        this.contributorContextFactory = factory ?? undefined;
    }

    async buildContributorContext(options?: {
        sessionId?: string | null;
    }): Promise<DynamicContributorContext> {
        const baseWorkspace = this.currentWorkspace ?? null;
        const sessionId =
            typeof options?.sessionId === 'string' && options.sessionId.length > 0
                ? options.sessionId
                : undefined;
        let sessionPromptContributors: NonNullable<
            NonNullable<DynamicContributorContext['session']>['systemPromptContributors']
        > = [];
        if (sessionId !== undefined && this.sessionManager) {
            try {
                sessionPromptContributors =
                    await this.sessionManager.getSessionSystemPromptContributors(sessionId);
            } catch (error) {
                if (
                    error instanceof DextoRuntimeError &&
                    error.scope === ErrorScope.SESSION &&
                    error.type === ErrorType.NOT_FOUND
                ) {
                    this.logger.debug('Session not found while building contributor context', {
                        sessionId,
                    });
                } else {
                    throw error;
                }
            }
        }
        const baseContext: DynamicContributorContext = {
            mcpManager: this.mcpManager,
            workspace: baseWorkspace,
            ...(sessionId !== undefined
                ? {
                      session: {
                          id: sessionId,
                          ...(sessionPromptContributors.length > 0
                              ? { systemPromptContributors: sessionPromptContributors }
                              : {}),
                      },
                  }
                : {}),
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
            const session =
                overrides.session !== undefined ? overrides.session : baseContext.session;
            const mcpManager = overrides.mcpManager ?? baseContext.mcpManager;
            return {
                mcpManager,
                workspace,
                ...(environment !== undefined ? { environment } : {}),
                ...(session !== undefined ? { session } : {}),
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
        runContext?: AgentRunContext | undefined;
    }): ToolExecutionContext {
        const workspace = this.currentWorkspace;
        const baseContext: ToolExecutionContextBase = {
            sessionId: options.sessionId,
            runContext: options.runContext,
            workspaceId: workspace?.id,
            workspace,
            abortSignal: options.abortSignal,
            toolCallId: options.toolCallId,
            hostRuntime: options.runContext?.hostRuntime,
            logger: this.logger,
        };
        return this.toolExecutionContextFactory(baseContext);
    }

    private resolveToolExecutionInvocation(
        invocation?: ToolExecutionInvocation
    ): ToolExecutionInvocation & {
        sessionId?: string | undefined;
        hostRuntime?: ToolExecutionContext['hostRuntime'];
    } {
        if (typeof invocation !== 'object' && invocation !== undefined) {
            throw new TypeError('Tool execution invocation must be an object');
        }

        const options = invocation ?? {};
        const sessionId = options.runContext?.sessionId ?? options.sessionId;

        return { ...options, sessionId, hostRuntime: options.runContext?.hostRuntime };
    }

    private resolveToolExecutionIdentity(
        invocation: ToolExecutionInvocation,
        toolCallId: string
    ): ToolExecutionIdentity | undefined {
        if (invocation.executionIdentity !== undefined) {
            return invocation.executionIdentity;
        }

        const ids = invocation.runContext?.hostRuntime?.ids;
        if (!ids) {
            return undefined;
        }

        const runId = ids.runId;
        const turnId = ids.turnId;
        const modelStepId = ids.modelStepId;
        if (runId === undefined || turnId === undefined || modelStepId === undefined) {
            return undefined;
        }

        return {
            runId,
            turnId,
            modelStepId,
            toolCallId,
        };
    }

    private assertToolExecutionRecordMatches(input: {
        record: ToolExecutionRecord;
        identity: ToolExecutionIdentity;
        toolName: string;
        toolInput: Record<string, unknown>;
    }): void {
        const expected = {
            identity: input.identity,
            toolName: input.toolName,
            input: input.toolInput,
        };
        const actual = {
            identity: input.record.identity,
            toolName: input.record.toolName,
            input: input.record.input,
        };

        if (!isDeepStrictEqual(actual, expected)) {
            throw ToolError.executionFailed(
                input.toolName,
                'Tool execution record does not match the current tool call'
            );
        }
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
        options?: {
            sessionId?: string | undefined;
            abortSignal?: AbortSignal | undefined;
            toolCallId?: string | undefined;
            runContext?: AgentRunContext | undefined;
        }
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
            const context = this.buildToolExecutionContext({
                sessionId: options?.sessionId,
                abortSignal: options?.abortSignal,
                toolCallId: options?.toolCallId,
                runContext: options?.runContext,
            });
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
            let description = tool.description || 'No description provided';
            if (tool.getDescription) {
                try {
                    const dynamicDescription = await tool.getDescription(
                        this.buildToolExecutionContext({})
                    );
                    if (dynamicDescription.trim()) {
                        description = dynamicDescription;
                    }
                } catch (error) {
                    this.logger.warn(
                        `Failed to build dynamic description for '${toolName}': ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            }

            allTools[toolName] = {
                name: toolName,
                description,
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
            await this.refreshDynamicToolDescriptions();
            return this.toolsCache;
        }

        this.toolsCache = await this.buildAllTools();
        this.cacheValid = true;
        return this.toolsCache;
    }

    async prepareToolCall(input: PrepareToolCallInput): Promise<PreparedToolCall> {
        const sessionId = input.runContext?.sessionId ?? input.sessionId;
        if (this.isInAlwaysDenyList(input.toolName)) {
            const deniedInput = isRecord(input.input) ? extractToolCallMeta(input.input) : null;
            const rawToolArgs = deniedInput?.toolArgs ?? {};
            const deniedMeta = deniedInput?.meta ?? {};
            const eventMeta: ToolCallMetadata | undefined =
                Object.keys(deniedMeta).length > 0 ? deniedMeta : undefined;
            const callDescription =
                typeof deniedMeta.callDescription === 'string'
                    ? deniedMeta.callDescription
                    : typeof rawToolArgs.description === 'string'
                      ? rawToolArgs.description
                      : undefined;
            const call: ExecutableToolCall = {
                input: rawToolArgs,
                presentationSnapshot: this.buildGenericToolPresentationSnapshot(input.toolName),
                source: input.toolName.startsWith(ToolManager.MCP_TOOL_PREFIX) ? 'mcp' : 'local',
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                ...(callDescription !== undefined ? { callDescription } : {}),
                ...(eventMeta !== undefined ? { meta: eventMeta } : {}),
            };
            return this.createPreparedToolTerminal('denied', input.toolName, call);
        }

        const source = await this.resolveExecutableToolSource(input.toolName);
        if (source === 'unknown') {
            return this.createPreparedToolError(
                'unknown-tool',
                input.toolName,
                `Tool '${input.toolName}' not found`
            );
        }

        if (!isRecord(input.input)) {
            return this.createPreparedToolError(
                'invalid-input',
                input.toolName,
                'Invalid arguments: expected an object'
            );
        }

        const { toolArgs: rawToolArgs, meta } = extractToolCallMeta(input.input);
        const eventMeta: ToolCallMetadata | undefined =
            Object.keys(meta).length > 0 ? meta : undefined;
        const callDescription =
            typeof meta.callDescription === 'string'
                ? meta.callDescription
                : typeof rawToolArgs.description === 'string'
                  ? rawToolArgs.description
                  : undefined;

        let validatedArgs: Record<string, unknown>;
        try {
            validatedArgs = this.validateLocalToolArgs(input.toolName, rawToolArgs);
        } catch (error) {
            return this.createPreparedToolError(
                'invalid-input',
                input.toolName,
                error instanceof Error ? error.message : String(error)
            );
        }

        const presentationSnapshot = await this.getToolPresentationSnapshotForCall(
            input.toolName,
            validatedArgs,
            input.toolCallId,
            sessionId,
            input.runContext
        );
        const call: ExecutableToolCall = {
            input: validatedArgs,
            presentationSnapshot,
            source,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            ...(callDescription !== undefined ? { callDescription } : {}),
            ...(eventMeta !== undefined ? { meta: eventMeta } : {}),
        };

        const overrideRequest = await this.getToolApprovalOverrideRequest(
            input.toolName,
            validatedArgs,
            input.toolCallId,
            sessionId,
            input.runContext
        );
        if (overrideRequest) {
            if (!overrideRequest.directoryAccess) {
                return {
                    kind: 'approval-required',
                    call,
                    onGrantedRequestDetails: overrideRequest.onGrantedRequestDetails,
                    requestDetails: overrideRequest.requestDetails,
                };
            }

            const quickResult = await this.classifyQuickApprovalRequirement(
                input.toolName,
                validatedArgs,
                sessionId,
                overrideRequest.directoryAccess
            );
            if (quickResult === 'ready') {
                return { kind: 'ready', call };
            }
            if (quickResult === 'denied') {
                return this.createPreparedToolTerminal('denied', input.toolName, call);
            }
            const displayPreview = await this.generateToolPreview(
                input.toolName,
                validatedArgs,
                input.toolCallId,
                sessionId,
                input.runContext
            );
            const suggestedPatterns = this.getToolSuggestedPatterns(input.toolName, validatedArgs);
            return {
                kind: 'approval-required',
                call,
                onGrantedRequestDetails: overrideRequest.onGrantedRequestDetails,
                requestDetails: {
                    ...overrideRequest.requestDetails,
                    metadata: {
                        ...overrideRequest.requestDetails.metadata,
                        presentationSnapshot,
                        ...(callDescription !== undefined ? { description: callDescription } : {}),
                        ...(displayPreview !== undefined ? { displayPreview } : {}),
                        ...(suggestedPatterns !== undefined ? { suggestedPatterns } : {}),
                    },
                },
            };
        }

        const quickResult = await this.classifyQuickApprovalRequirement(
            input.toolName,
            validatedArgs,
            sessionId
        );
        if (quickResult === 'ready') {
            return { kind: 'ready', call };
        }
        if (quickResult === 'denied') {
            return this.createPreparedToolTerminal('denied', input.toolName, call);
        }

        const displayPreview = await this.generateToolPreview(
            input.toolName,
            validatedArgs,
            input.toolCallId,
            sessionId,
            input.runContext
        );
        const suggestedPatterns = this.getToolSuggestedPatterns(input.toolName, validatedArgs);
        const hostRuntime = input.runContext?.hostRuntime;
        const requestDetails: ApprovalRequestDetails = {
            type: ApprovalType.TOOL_APPROVAL,
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(hostRuntime !== undefined ? { hostRuntime } : {}),
            metadata: {
                toolName: input.toolName,
                presentationSnapshot,
                toolCallId: input.toolCallId,
                args: validatedArgs,
                ...(callDescription !== undefined ? { description: callDescription } : {}),
                ...(displayPreview !== undefined ? { displayPreview } : {}),
                ...(suggestedPatterns !== undefined ? { suggestedPatterns } : {}),
            },
        };

        return {
            kind: 'approval-required',
            call,
            onGrantedRequestDetails: requestDetails,
            requestDetails,
        };
    }

    async recordApprovalRequest(
        prepared: ApprovalRequiredPreparedToolCall,
        identity: ToolApprovalRecordIdentity
    ): Promise<RecordedToolApproval> {
        this.assertOnGrantedRequestMatchesPreparedCall(prepared);
        const request = await this.approvalManager.recordApprovalRequest(prepared.requestDetails, {
            ...identity,
            toolCallId: prepared.call.toolCallId,
        });
        this.assertRecordedApprovalMatchesPreparedCall(prepared, request);
        return { prepared, request };
    }

    async applyApprovalDecision(
        recorded: RecordedToolApproval,
        decision: ApprovalDecisionInput,
        runContext?: AgentRunContext
    ): Promise<ToolApprovalDecisionApplication> {
        if (decision.approvalId !== recorded.request.approvalId) {
            throw ToolError.executionFailed(
                recorded.prepared.call.toolName,
                'Approval decision does not match the recorded approval request'
            );
        }
        this.assertOnGrantedRequestMatchesPreparedCall(recorded.prepared);
        this.assertRecordedApprovalMatchesPreparedCall(recorded.prepared, recorded.request);

        const record = await this.approvalManager.recordApprovalResponseRecord(
            decision,
            recorded.request
        );

        if (record.response.status !== ApprovalStatus.APPROVED) {
            return {
                kind: 'terminal',
                modelVisibleResult: this.createApprovalTerminalResult(
                    recorded.prepared.call,
                    record.response
                ),
                response: record.response,
            };
        }

        await this.applyApprovalGrantedEffects(recorded.prepared, record.response, runContext);
        return {
            kind: 'ready',
            call: {
                ...recorded.prepared.call,
                approval: {
                    requireApproval: true,
                    approvalStatus: 'approved',
                },
            },
            response: record.response,
        };
    }

    async requestApprovalDecision(recorded: RecordedToolApproval): Promise<ApprovalResponse> {
        return this.approvalManager.requestApprovalDecision(recorded.request);
    }

    private assertRecordedApprovalMatchesPreparedCall(
        prepared: ApprovalRequiredPreparedToolCall,
        request: ApprovalRequest
    ): void {
        const expected = {
            type: prepared.requestDetails.type,
            sessionId: prepared.requestDetails.sessionId,
            hostRuntime: prepared.requestDetails.hostRuntime,
            metadata: prepared.requestDetails.metadata,
        };
        const actual = {
            type: request.type,
            sessionId: request.sessionId,
            hostRuntime: request.hostRuntime,
            metadata: request.metadata,
        };

        if (!isDeepStrictEqual(actual, expected)) {
            throw ToolError.executionFailed(
                prepared.call.toolName,
                'Recorded approval request does not match the prepared tool call'
            );
        }
    }

    private assertOnGrantedRequestMatchesPreparedCall(
        prepared: ApprovalRequiredPreparedToolCall
    ): void {
        const approvalDetails = prepared.requestDetails;
        const grantedDetails = prepared.onGrantedRequestDetails;
        const directoryAccess =
            approvalDetails.type === ApprovalType.TOOL_APPROVAL &&
            'directoryAccess' in approvalDetails.metadata
                ? DirectoryAccessMetadataSchema.parse(approvalDetails.metadata.directoryAccess)
                : undefined;

        if (directoryAccess !== undefined) {
            const expected = {
                type: ApprovalType.DIRECTORY_ACCESS,
                sessionId: approvalDetails.sessionId,
                hostRuntime: approvalDetails.hostRuntime,
                metadata: directoryAccess,
            };
            const actual = {
                type: grantedDetails.type,
                sessionId: grantedDetails.sessionId,
                hostRuntime: grantedDetails.hostRuntime,
                metadata: grantedDetails.metadata,
            };

            if (!isDeepStrictEqual(actual, expected)) {
                throw ToolError.executionFailed(
                    prepared.call.toolName,
                    'Approval granted-effects request does not match the prepared tool call'
                );
            }
            return;
        }

        if (!isDeepStrictEqual(grantedDetails, approvalDetails)) {
            throw ToolError.executionFailed(
                prepared.call.toolName,
                'Approval granted-effects request does not match the prepared tool call'
            );
        }
    }

    private async applyApprovalGrantedEffects(
        prepared: ApprovalRequiredPreparedToolCall,
        response: ApprovalResponse,
        runContext?: AgentRunContext
    ): Promise<void> {
        const requestDetails = prepared.onGrantedRequestDetails;
        const approvalRequestDetails = prepared.requestDetails;
        const sessionId = approvalRequestDetails.sessionId;
        const onGranted = this.getToolApprovalOnGrantedFn(prepared.call.toolName);

        if (onGranted) {
            const context = this.buildToolExecutionContext({
                sessionId,
                toolCallId: prepared.call.toolCallId,
                runContext,
            });
            await Promise.resolve(onGranted(response, context, requestDetails));
        }

        if (approvalRequestDetails.type === ApprovalType.TOOL_APPROVAL && response.data) {
            await this.handleRememberChoice(prepared.call.toolName, response, sessionId);
        }
    }

    private createApprovalTerminalResult(
        call: ExecutableToolCall,
        response: ApprovalResponse
    ): ToolExecutionResult {
        return {
            result: {
                error: this.formatApprovalTerminalMessage(call.toolName, response),
            },
            presentationSnapshot: call.presentationSnapshot,
            ...(call.meta !== undefined ? { meta: call.meta } : {}),
            requireApproval: true,
            approvalStatus: 'rejected',
        };
    }

    private formatApprovalTerminalMessage(toolName: string, response: ApprovalResponse): string {
        if (
            response.status === ApprovalStatus.CANCELLED &&
            response.reason === DenialReason.TIMEOUT
        ) {
            return `Tool '${toolName}' was not executed because approval timed out${
                response.timeoutMs !== undefined ? ` after ${response.timeoutMs}ms` : ''
            }.`;
        }

        const outcome =
            response.status === ApprovalStatus.DENIED
                ? 'approval was denied'
                : 'approval was cancelled';
        return `Tool '${toolName}' was not executed because ${outcome}${
            response.message ? `: ${response.message}` : ''
        }.`;
    }

    private async resolveExecutableToolSource(
        toolName: string
    ): Promise<'local' | 'mcp' | 'unknown'> {
        if (this.agentTools.has(toolName)) {
            return 'local';
        }

        if (
            toolName.startsWith(ToolManager.MCP_TOOL_PREFIX) &&
            toolName.length > ToolManager.MCP_TOOL_PREFIX.length
        ) {
            return 'mcp';
        }

        return 'unknown';
    }

    private createPreparedToolError(
        kind: 'invalid-input' | 'unknown-tool',
        toolName: string,
        error: string
    ): PreparedToolCall {
        return {
            kind: 'terminal',
            reason: kind,
            modelVisibleResult: {
                result: { error },
                presentationSnapshot: this.buildGenericToolPresentationSnapshot(toolName),
            },
        };
    }

    private createPreparedToolTerminal(
        reason: 'denied',
        toolName: string,
        call: ExecutableToolCall
    ): PreparedToolCall {
        return {
            kind: 'terminal',
            reason,
            call,
            modelVisibleResult: {
                result: {
                    error: `Tool '${toolName}' was not executed because policy denied it.`,
                },
                presentationSnapshot: call.presentationSnapshot,
                ...(call.meta !== undefined ? { meta: call.meta } : {}),
            },
        };
    }

    private async getToolApprovalOverrideRequest(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string,
        runContext?: AgentRunContext
    ): Promise<{
        requestDetails: ApprovalRequestDetails;
        onGrantedRequestDetails: ApprovalRequestDetails;
        directoryAccess?: DirectoryAccessMetadata;
    } | null> {
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            return null;
        }

        const getApprovalOverride = this.getToolApprovalOverrideFn(toolName);
        if (!getApprovalOverride) {
            return null;
        }

        const context = this.buildToolExecutionContext({ sessionId, toolCallId, runContext });
        const approvalRequest = await getApprovalOverride(args, context);
        if (!approvalRequest) {
            return null;
        }

        const requestDetails: ApprovalRequestDetails = {
            ...approvalRequest,
            ...(sessionId && !approvalRequest.sessionId ? { sessionId } : {}),
            ...(runContext?.hostRuntime !== undefined && approvalRequest.hostRuntime === undefined
                ? { hostRuntime: runContext.hostRuntime }
                : {}),
        };

        if (requestDetails.type !== ApprovalType.DIRECTORY_ACCESS) {
            return { requestDetails, onGrantedRequestDetails: requestDetails };
        }

        const parseResult = DirectoryAccessMetadataSchema.safeParse(requestDetails.metadata);
        if (!parseResult.success) {
            throw ToolError.configInvalid(
                `Tool '${toolName}' returned invalid directory access metadata`
            );
        }

        const directoryAccess = parseResult.data;
        return {
            directoryAccess,
            onGrantedRequestDetails: requestDetails,
            requestDetails: {
                type: ApprovalType.TOOL_APPROVAL,
                ...(requestDetails.sessionId !== undefined
                    ? { sessionId: requestDetails.sessionId }
                    : {}),
                ...(requestDetails.hostRuntime !== undefined
                    ? { hostRuntime: requestDetails.hostRuntime }
                    : {}),
                metadata: {
                    toolName,
                    toolCallId,
                    args,
                    directoryAccess,
                },
            },
        };
    }

    private async classifyQuickApprovalRequirement(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string,
        directoryAccess?: DirectoryAccessMetadata
    ): Promise<'ready' | 'approval-required' | 'denied'> {
        if (directoryAccess) {
            return this.approvalMode === 'auto-approve' ? 'ready' : 'approval-required';
        }

        if (sessionId && this.isToolAutoApprovedForSession(sessionId, toolName)) {
            return 'ready';
        }

        if (this.isInAlwaysAllowList(toolName)) {
            return 'ready';
        }

        if (await this.allowedToolsProvider.isToolAllowed(toolName, sessionId)) {
            return 'ready';
        }

        const patternKey = this.getToolPatternKey(toolName, args);
        if (patternKey && this.approvalManager.matchesPattern(toolName, patternKey, sessionId)) {
            return 'ready';
        }

        if (this.approvalMode === 'auto-approve') {
            return 'ready';
        }

        if (this.approvalMode === 'auto-deny') {
            return 'denied';
        }

        return 'approval-required';
    }

    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        invocation?: ToolExecutionInvocation
    ): Promise<import('./types.js').ToolExecutionResult> {
        const { sessionId, runContext, hostRuntime } =
            this.resolveToolExecutionInvocation(invocation);

        this.logger.debug(`🔧 Tool execution requested: '${toolName}' (toolCallId: ${toolCallId})`);
        this.logger.debug(`Tool args: ${JSON.stringify(args, null, 2)}`);

        if (toolName === ToolManager.MCP_TOOL_PREFIX) {
            throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
        }

        const prepared = await this.prepareToolCall({
            toolName,
            input: args,
            toolCallId,
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(runContext !== undefined ? { runContext } : {}),
        });

        if (prepared.kind === 'terminal') {
            this.throwPreparedTerminalResult(toolName, prepared, sessionId);
        }

        this.emitPreparedToolCallEvent(prepared.call, sessionId, runContext, hostRuntime);
        const replayed = await this.replayExistingDirectToolExecution(prepared.call, invocation);
        if (replayed !== undefined) {
            return replayed;
        }

        if (prepared.kind === 'ready') {
            return this.executePreparedToolCall(prepared.call, invocation, { throwOnError: true });
        }

        let applied: ToolApprovalDecisionApplication;
        try {
            const recorded = await this.recordApprovalRequest(
                prepared,
                this.resolveDirectApprovalIdentity(invocation, toolCallId)
            );
            const response = await this.requestApprovalDecision(recorded);
            applied = await this.applyApprovalDecision(
                recorded,
                {
                    approvalId: response.approvalId,
                    status: response.status,
                    ...(response.reason !== undefined ? { reason: response.reason } : {}),
                    ...(response.message !== undefined ? { message: response.message } : {}),
                    ...(response.data !== undefined ? { data: response.data } : {}),
                },
                runContext
            );
        } catch (error) {
            await this.recordDirectToolExecutionFailure(prepared.call, invocation, error);
            throw error;
        }

        if (applied.kind === 'terminal') {
            try {
                this.handleApprovalDenied(toolName, applied.response, sessionId);
            } catch (error) {
                await this.recordDirectToolExecutionFailure(prepared.call, invocation, error);
                throw error;
            }
        }

        return this.executePreparedToolCall(applied.call, invocation, { throwOnError: true });
    }

    private emitPreparedToolCallEvent(
        call: ExecutableToolCall,
        sessionId: string | undefined,
        runContext: AgentRunContext | undefined,
        hostRuntime: AgentRunContext['hostRuntime'] | undefined
    ): void {
        if (!sessionId) {
            return;
        }

        this.agentEventBus.emit('llm:tool-call', {
            toolName: call.toolName,
            presentationSnapshot: this.getToolPresentationSnapshotForToolCallEvent(
                call.toolName,
                call.input,
                call.toolCallId,
                sessionId,
                runContext
            ),
            args: call.input,
            ...(call.meta !== undefined ? { meta: call.meta } : {}),
            ...(call.callDescription !== undefined
                ? { callDescription: call.callDescription }
                : {}),
            callId: call.toolCallId,
            sessionId,
            ...(hostRuntime !== undefined && { hostRuntime }),
        });
    }

    private async replayExistingDirectToolExecution(
        call: ExecutableToolCall,
        invocation: ToolExecutionInvocation | undefined
    ): Promise<ToolExecutionResult | undefined> {
        const { sessionId } = this.resolveToolExecutionInvocation(invocation);
        if (
            isBackgroundTasksEnabled() &&
            call.meta?.runInBackground === true &&
            sessionId !== undefined
        ) {
            return undefined;
        }

        const identity = this.resolveToolExecutionIdentity(invocation ?? {}, call.toolCallId);
        if (identity === undefined) {
            return undefined;
        }

        const executionId = createToolExecutionId(identity);
        const record = await this.toolExecutionStore.get({ executionId });
        if (record === undefined) {
            return undefined;
        }

        this.assertToolExecutionRecordMatches({
            record,
            identity,
            toolName: call.toolName,
            toolInput: call.input,
        });
        if (record.status === 'completed') {
            this.logger.info('Replaying completed direct tool execution result', {
                executionId,
                toolName: call.toolName,
            });
            return completedToolExecutionToResult(record);
        }
        if (record.status === 'failed') {
            throw ToolError.executionFailed(
                call.toolName,
                `Tool execution already failed: ${executionId}`
            );
        }
        throw ToolError.executionFailed(
            call.toolName,
            `Tool execution already ${record.status}: ${executionId}`
        );
    }

    private async recordDirectToolExecutionFailure(
        call: ExecutableToolCall,
        invocation: ToolExecutionInvocation | undefined,
        error: unknown
    ): Promise<void> {
        const identity = this.resolveToolExecutionIdentity(invocation ?? {}, call.toolCallId);
        if (identity === undefined) {
            return;
        }

        const executionId = createToolExecutionId(identity);
        const started = await this.toolExecutionStore.start({
            record: {
                executionId,
                identity,
                input: call.input,
                toolName: call.toolName,
                status: 'running',
                startedAt: new Date(),
                updatedAt: new Date(),
            },
        });
        if (started.status === 'existing') {
            this.assertToolExecutionRecordMatches({
                record: started.record,
                identity,
                toolName: call.toolName,
                toolInput: call.input,
            });
            if (started.record.status !== 'running') {
                return;
            }
        }

        await this.toolExecutionStore.fail({
            executionId,
            completedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
        });
    }

    private resolveDirectApprovalIdentity(
        invocation: ToolExecutionInvocation | undefined,
        toolCallId: string
    ): ToolApprovalRecordIdentity {
        const executionIdentity = this.resolveToolExecutionIdentity(invocation ?? {}, toolCallId);
        if (executionIdentity !== undefined) {
            return {
                runId: executionIdentity.runId,
                turnId: executionIdentity.turnId,
                modelStepId: executionIdentity.modelStepId,
            };
        }

        const ids = invocation?.runContext?.hostRuntime?.ids;
        const runId = ids?.runId;
        const turnId = ids?.turnId;
        const modelStepId = ids?.modelStepId;
        if (runId !== undefined && turnId !== undefined && modelStepId !== undefined) {
            return { runId, turnId, modelStepId };
        }

        return {
            runId: invocation?.sessionId ?? invocation?.runContext?.sessionId ?? 'direct',
            turnId: 'direct',
            modelStepId: 'direct',
        };
    }

    private throwPreparedTerminalResult(
        toolName: string,
        prepared: Extract<PreparedToolCall, { kind: 'terminal' }>,
        sessionId?: string
    ): never {
        if (prepared.reason === 'unknown-tool') {
            throw ToolError.notFound(toolName);
        }

        if (prepared.reason === 'denied') {
            throw ToolError.executionDenied(toolName, sessionId);
        }

        if (prepared.reason === 'invalid-input') {
            throw ToolError.validationFailed(
                toolName,
                this.getPreparedTerminalMessage(prepared.modelVisibleResult)
            );
        }

        throw ToolError.executionFailed(
            toolName,
            this.getPreparedTerminalMessage(prepared.modelVisibleResult),
            sessionId
        );
    }

    private getPreparedTerminalMessage(result: ToolExecutionResult): string {
        const output = result.result;
        if (isRecord(output) && typeof output.error === 'string') {
            return output.error;
        }
        return 'Tool call could not be prepared for execution';
    }

    async executePreparedToolCall(
        call: ExecutableToolCall,
        invocation?: ToolExecutionInvocation,
        options?: { throwOnError?: boolean }
    ): Promise<ToolExecutionResult> {
        const { sessionId, abortSignal, runContext, hostRuntime } =
            this.resolveToolExecutionInvocation(invocation);
        const durableIdentity = this.resolveToolExecutionIdentity(
            invocation ?? {},
            call.toolCallId
        );
        const backgroundTasksEnabled = isBackgroundTasksEnabled();
        const willRunInBackground =
            backgroundTasksEnabled &&
            call.meta?.runInBackground === true &&
            sessionId !== undefined;
        const executionIdentity = willRunInBackground ? undefined : durableIdentity;
        const executionId =
            executionIdentity === undefined ? undefined : createToolExecutionId(executionIdentity);
        let toolArgs = call.input;

        this.logger.debug(
            `🔧 Prepared tool execution requested: '${call.toolName}' (toolCallId: ${call.toolCallId})`
        );

        if (executionIdentity !== undefined && executionId !== undefined) {
            const started = await this.toolExecutionStore.start({
                record: {
                    executionId,
                    identity: executionIdentity,
                    input: call.input,
                    toolName: call.toolName,
                    status: 'running',
                    startedAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            if (started.status === 'existing') {
                this.assertToolExecutionRecordMatches({
                    record: started.record,
                    identity: executionIdentity,
                    toolName: call.toolName,
                    toolInput: call.input,
                });
                if (started.record.status === 'completed') {
                    this.logger.info('Replaying completed prepared tool execution result', {
                        executionId,
                        toolName: call.toolName,
                    });
                    return completedToolExecutionToResult(started.record);
                }
                if (started.record.status === 'failed') {
                    this.logger.info('Replaying failed prepared tool execution result', {
                        executionId,
                        toolName: call.toolName,
                    });
                    if (options?.throwOnError === true) {
                        throw ToolError.executionFailed(
                            call.toolName,
                            `Tool execution already failed: ${executionId}`
                        );
                    }
                    return this.createFailedPreparedToolResult(call, started.record.error);
                }
                throw ToolError.executionFailed(
                    call.toolName,
                    `Tool execution already ${started.record.status}: ${executionId}`
                );
            }
        }

        const startTime = Date.now();

        try {
            this.logger.info(
                `🔧 Prepared tool execution started for ${call.toolName}, sessionId: ${sessionId ?? 'global'}`
            );

            if (sessionId) {
                this.agentEventBus.emit('tool:running', {
                    toolName: call.toolName,
                    toolCallId: call.toolCallId,
                    sessionId,
                    ...(hostRuntime !== undefined && { hostRuntime }),
                });
            }

            if (this.hookManager && this.sessionManager && this.stateManager) {
                const beforePayload: BeforeToolCallPayload = {
                    toolName: call.toolName,
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
                        ...(runContext !== undefined && { runContext }),
                        ...(sessionId !== undefined && { sessionId }),
                    }
                );

                toolArgs = modifiedPayload.args;
                try {
                    toolArgs = this.validateLocalToolArgs(call.toolName, toolArgs);
                } catch (error) {
                    this.logger.error(
                        `Post-hook validation failed for tool '${call.toolName}': a beforeToolCall hook may have set invalid args`
                    );
                    throw error;
                }
            }

            let result: unknown;

            const registerBackgroundTask = (promise: Promise<unknown>, description: string) => {
                return {
                    result: {
                        taskId: call.toolCallId,
                        status: 'running' as const,
                        description,
                    },
                    promise,
                };
            };

            if (call.source === 'mcp') {
                const actualToolName = call.toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(
                        call.toolName,
                        'tool name cannot be empty after prefix'
                    );
                }

                const executeMcpTool = () =>
                    runContext === undefined
                        ? this.mcpManager.executeTool(actualToolName, toolArgs, sessionId)
                        : this.mcpManager.executeTool(
                              actualToolName,
                              toolArgs,
                              sessionId,
                              runContext
                          );
                if (call.meta?.runInBackground === true && !backgroundTasksEnabled) {
                    this.logger.debug(
                        'Background tool execution disabled; running synchronously instead.',
                        { toolName: call.toolName }
                    );
                }
                if (willRunInBackground) {
                    const backgroundSessionId = sessionId;
                    const { result: backgroundResult, promise } = registerBackgroundTask(
                        executeMcpTool(),
                        `MCP tool ${actualToolName}`
                    );
                    this.agentEventBus.emit('tool:background', {
                        toolName: call.toolName,
                        toolCallId: backgroundResult.taskId,
                        sessionId: backgroundSessionId,
                        description: backgroundResult.description,
                        promise,
                        ...(hostRuntime !== undefined && { hostRuntime }),
                        ...(call.meta?.timeoutMs !== undefined && {
                            timeoutMs: call.meta.timeoutMs,
                        }),
                        ...(call.meta?.notifyOnComplete !== undefined && {
                            notifyOnComplete: call.meta.notifyOnComplete,
                        }),
                    });
                    result = backgroundResult;
                } else {
                    result = await executeMcpTool();
                }
            } else {
                if (call.meta?.runInBackground === true && !backgroundTasksEnabled) {
                    this.logger.debug(
                        'Background tool execution disabled; running synchronously instead.',
                        { toolName: call.toolName }
                    );
                }

                if (willRunInBackground) {
                    const backgroundSessionId = sessionId;
                    const { result: backgroundResult, promise } = registerBackgroundTask(
                        this.executeLocalTool(call.toolName, toolArgs, {
                            sessionId: backgroundSessionId,
                            abortSignal,
                            toolCallId: call.toolCallId,
                            runContext,
                        }),
                        `Tool ${call.toolName}`
                    );
                    this.agentEventBus.emit('tool:background', {
                        toolName: call.toolName,
                        toolCallId: backgroundResult.taskId,
                        sessionId: backgroundSessionId,
                        description: backgroundResult.description,
                        promise,
                        ...(hostRuntime !== undefined && { hostRuntime }),
                        ...(call.meta?.timeoutMs !== undefined && {
                            timeoutMs: call.meta.timeoutMs,
                        }),
                        ...(call.meta?.notifyOnComplete !== undefined && {
                            notifyOnComplete: call.meta.notifyOnComplete,
                        }),
                    });
                    result = backgroundResult;
                } else {
                    result = await this.executeLocalTool(call.toolName, toolArgs, {
                        sessionId,
                        abortSignal,
                        toolCallId: call.toolCallId,
                        runContext,
                    });
                }
            }

            const duration = Date.now() - startTime;
            this.logger.debug(
                `🎯 Prepared tool execution completed in ${duration}ms: '${call.toolName}'`
            );

            if (this.hookManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName: call.toolName,
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
                        ...(runContext !== undefined && { runContext }),
                        ...(sessionId !== undefined && { sessionId }),
                    }
                );

                result = modifiedPayload.result;
            }

            const presentationSnapshot = await this.augmentSnapshotWithResult(
                call.toolName,
                call.presentationSnapshot,
                result,
                toolArgs,
                call.toolCallId,
                sessionId,
                runContext
            );

            const executionResult = {
                result,
                ...(presentationSnapshot !== undefined && { presentationSnapshot }),
                ...(call.meta !== undefined ? { meta: call.meta } : {}),
                ...(call.approval !== undefined ? call.approval : {}),
            };

            if (executionId !== undefined) {
                await this.toolExecutionStore.complete({
                    executionId,
                    completedAt: new Date(),
                    result: executionResult,
                });
            }

            return executionResult;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error(
                `❌ Prepared tool execution failed for ${call.toolName} after ${duration}ms, sessionId: ${sessionId ?? 'global'}: ${error instanceof Error ? error.message : String(error)}`
            );
            const message = error instanceof Error ? error.message : String(error);

            if (executionId !== undefined) {
                await this.toolExecutionStore.fail({
                    executionId,
                    completedAt: new Date(),
                    error: message,
                });
            }

            if (this.hookManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName: call.toolName,
                    result: error instanceof Error ? error.message : String(error),
                    success: false,
                    ...(sessionId !== undefined && { sessionId }),
                };

                await this.hookManager.executeHooks('afterToolResult', afterPayload, {
                    sessionManager: this.sessionManager,
                    mcpManager: this.mcpManager,
                    toolManager: this,
                    stateManager: this.stateManager,
                    ...(runContext !== undefined && { runContext }),
                    ...(sessionId !== undefined && { sessionId }),
                });
            }

            if (options?.throwOnError === true) {
                throw error;
            }

            return this.createFailedPreparedToolResult(call, message);
        }
    }

    private createFailedPreparedToolResult(
        call: ExecutableToolCall,
        error: string
    ): ToolExecutionResult {
        return {
            result: { error },
            presentationSnapshot: call.presentationSnapshot,
            ...(call.meta !== undefined ? { meta: call.meta } : {}),
            ...(call.approval !== undefined ? call.approval : {}),
        };
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
     * Generate a preview for the tool approval UI if the tool supports it.
     */
    private async generateToolPreview(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string,
        runContext?: AgentRunContext
    ): Promise<ToolDisplayData | undefined> {
        const previewFn = this.getToolPreviewFn(toolName);
        if (!previewFn) {
            return undefined;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId, runContext });
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
     * Handle "remember" actions when user approves a tool.
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
        const rememberDirectory = data.rememberDirectory as boolean | undefined;

        if (rememberChoice) {
            const allowSessionId = sessionId ?? response.sessionId;
            await this.allowedToolsProvider.allowTool(toolName, allowSessionId);
            this.logger.info(
                `Tool '${toolName}' added to allowed tools for session '${allowSessionId ?? 'global'}' (remember choice selected)`
            );
            this.autoApprovePendingToolRequests(toolName, allowSessionId);
        } else if (rememberPattern && this.getToolApprovalPatternKeyFn(toolName)) {
            await this.approvalManager.addPattern(toolName, rememberPattern, sessionId);
            this.logger.info(`Pattern '${rememberPattern}' added for tool '${toolName}' approval`);
            this.autoApprovePendingPatternRequests(toolName, sessionId);
        } else if (rememberDirectory) {
            const allowSessionId = sessionId ?? response.sessionId;
            this.autoApprovePendingDirectoryRequests(toolName, allowSessionId);
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
                `Tool approval timed out for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );
            throw ToolError.executionTimeout(toolName, response.timeoutMs ?? 0, sessionId);
        }

        this.logger.info(
            `Tool approval denied for ${toolName}, sessionId: ${sessionId ?? 'global'}, reason: ${response.reason ?? 'unknown'}`
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
