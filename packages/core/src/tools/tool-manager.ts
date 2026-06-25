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
import { ToolError } from './errors.js';
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
    ToolApprovalResponseData,
} from '../approval/types.js';
import { ToolApprovalMetadataSchema, ToolApprovalResponseDataSchema } from '../approval/schemas.js';
import type { AllowedToolsProvider } from './approval/allowed-tools-provider/types.js';
import { matchesToolPolicyPattern, SessionToolPolicy } from './approval/session-tool-policy.js';
import { ToolApprovalPolicy, type ToolApprovalGate } from './approval/tool-approval-policy.js';
import { ToolPresentation } from './presentation/tool-presentation.js';
import type { HookManager } from '../hooks/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../hooks/types.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { WorkspaceContext } from '../workspace/types.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import type { SessionToolPreferencesStore } from './session-tool-preferences-store.js';
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
    private approvalMode: 'manual' | 'auto-approve';
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
    private readonly sessionToolPolicy: SessionToolPolicy;
    private readonly toolApprovalPolicy: ToolApprovalPolicy;
    private readonly toolPresentation: ToolPresentation;
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
        approvalMode: 'manual' | 'auto-approve',
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
        this.sessionToolPolicy = new SessionToolPolicy(
            sessionToolPreferencesStore,
            this.logger,
            (pattern) => this.normalizeToolPolicyPattern(pattern)
        );
        this.toolApprovalPolicy = new ToolApprovalPolicy({
            getApprovalMode: () => this.approvalMode,
            getLocalTool: (toolName) => this.agentTools.get(toolName),
            isApprovalKeySessionApproved: ({ approvalKey, sessionId }) =>
                this.approvalManager.isApprovalKeySessionApproved(approvalKey, sessionId),
            isToolExplicitlyAllowed: async ({ toolName, sessionId }) => {
                if (
                    sessionId !== undefined &&
                    this.isToolAutoApprovedForSession(sessionId, toolName)
                ) {
                    return true;
                }

                if (this.isInAlwaysAllowList(toolName)) {
                    return true;
                }

                return await this.allowedToolsProvider.isToolAllowed(toolName, sessionId);
            },
        });
        this.toolPresentation = new ToolPresentation(
            (toolName) => this.agentTools.get(toolName),
            (toolName, args) => this.validateLocalToolArgs(toolName, args),
            (options) => this.buildToolExecutionContext(options),
            this.logger
        );
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

    async restoreSessionState(sessionId: string): Promise<void> {
        await this.sessionToolPolicy.restoreSessionState(sessionId);
    }

    evictSessionState(sessionId: string): void {
        this.sessionToolPolicy.evictSessionState(sessionId);
    }

    async deleteSessionState(sessionId: string): Promise<void> {
        await this.sessionToolPolicy.deleteSessionState(sessionId);
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
     * When set, these tools will skip approval prompts for this session.
     * This is ADDITIVE - other tools are NOT blocked, they just go through normal approval flow.
     *
     * @param sessionId The session ID
     * @param autoApproveTools Array of tool names to auto-approve (e.g., ['bash_exec', 'mcp--read_file'])
     */
    setSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        this.sessionToolPolicy.setSessionAutoApproveTools(sessionId, autoApproveTools);
    }

    /**
     * Add session-level auto-approve tools.
     * Merges into the existing list instead of replacing it.
     *
     * @param sessionId The session ID
     * @param autoApproveTools Array of tool names to auto-approve (e.g., ['bash_exec', 'mcp--read_file'])
     */
    addSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        this.sessionToolPolicy.addSessionAutoApproveTools(sessionId, autoApproveTools);
    }

    /**
     * Set session-level auto-approve tools chosen by the user.
     */
    async setSessionUserAutoApproveTools(
        sessionId: string,
        autoApproveTools: string[]
    ): Promise<void> {
        await this.sessionToolPolicy.setSessionUserAutoApproveTools(sessionId, autoApproveTools);
    }

    /**
     * Clear session-level auto-approve tools chosen by the user.
     */
    async clearSessionUserAutoApproveTools(sessionId: string): Promise<void> {
        await this.sessionToolPolicy.clearSessionUserAutoApproveTools(sessionId);
    }

    /**
     * Clear session-level auto-approve tools.
     * Call this when the session ends or when the skill completes.
     *
     * @param sessionId The session ID to clear auto-approve tools for
     */
    clearSessionAutoApproveTools(sessionId: string): void {
        this.sessionToolPolicy.clearSessionAutoApproveTools(sessionId);
    }

    hasSessionUserAutoApproveTools(sessionId: string): boolean {
        return this.sessionToolPolicy.hasSessionUserAutoApproveTools(sessionId);
    }

    // ============= ENABLED/DISABLED TOOLS =============

    /**
     * Set global disabled tools (agent-level preferences).
     */
    setGlobalDisabledTools(toolNames: string[]): void {
        this.sessionToolPolicy.setGlobalDisabledTools(toolNames);
        this.agentEventBus.emit('tools:enabled-updated', {
            scope: 'global',
            disabledTools: this.sessionToolPolicy.getGlobalDisabledTools(),
        });
    }

    getGlobalDisabledTools(): string[] {
        return this.sessionToolPolicy.getGlobalDisabledTools();
    }

    /**
     * Set session-level disabled tools (overrides global list).
     */
    async setSessionDisabledTools(sessionId: string, toolNames: string[]): Promise<void> {
        await this.sessionToolPolicy.setSessionDisabledTools(sessionId, toolNames);
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
        await this.sessionToolPolicy.clearSessionDisabledTools(sessionId);
    }

    /**
     * Get disabled tools for a session (session override wins).
     */
    getDisabledTools(sessionId?: string): string[] {
        return this.sessionToolPolicy.getDisabledTools(sessionId);
    }

    /**
     * Filter a tool set based on disabled tools for a session.
     */
    filterToolsForSession(toolSet: ToolSet, sessionId?: string): ToolSet {
        return this.sessionToolPolicy.filterToolsForSession(toolSet, sessionId);
    }

    /**
     * Check if a session has auto-approve tools set.
     *
     * @param sessionId The session ID to check
     * @returns true if the session has auto-approve tools
     */
    hasSessionAutoApproveTools(sessionId: string): boolean {
        return this.sessionToolPolicy.hasSessionAutoApproveTools(sessionId);
    }

    /**
     * Get the auto-approve tools for a session (skill-provided list).
     *
     * @param sessionId The session ID to check
     * @returns Array of auto-approve tool names, or undefined if none set
     */
    getSessionAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionToolPolicy.getSessionAutoApproveTools(sessionId);
    }

    /**
     * Get the user auto-approve tools for a session.
     */
    getSessionUserAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionToolPolicy.getSessionUserAutoApproveTools(sessionId);
    }

    /**
     * Combined auto-approve list for a session.
     */
    getCombinedSessionAutoApproveTools(sessionId: string): string[] {
        return this.sessionToolPolicy.getCombinedSessionAutoApproveTools(sessionId);
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
        return this.sessionToolPolicy.isToolAutoApprovedForSession(sessionId, toolName);
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

    // ==================== Approval Helpers ====================

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

                return true;
            },
            { rememberChoice: false } // Don't propagate remember choice to auto-approved requests
        );

        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} parallel request(s) for tool '${toolName}' after user selected "remember choice"`
            );
        }
    }

    private autoApprovePendingApprovalKeyRequests(approvalKey: string, sessionId?: string): void {
        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                if (request.type !== ApprovalType.TOOL_APPROVAL) {
                    return false;
                }

                if (request.sessionId !== sessionId) {
                    return false;
                }

                return request.metadata.approvalKey === approvalKey;
            },
            { rememberChoice: false }
        );

        if (count > 0) {
            this.logger.info(
                'Auto-approved parallel request(s) after approval key was remembered',
                {
                    count,
                }
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

        const presentationSnapshot = await this.toolPresentation.snapshotForCall({
            toolName: input.toolName,
            args: validatedArgs,
            toolCallId: input.toolCallId,
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(input.runContext !== undefined ? { runContext: input.runContext } : {}),
        });
        const call: ExecutableToolCall = {
            input: validatedArgs,
            presentationSnapshot,
            source,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            ...(callDescription !== undefined ? { callDescription } : {}),
            ...(eventMeta !== undefined ? { meta: eventMeta } : {}),
        };

        const approvalGate = await this.toolApprovalPolicy.resolve({
            args: validatedArgs,
            getContext: () =>
                this.buildToolExecutionContext({
                    sessionId,
                    toolCallId: input.toolCallId,
                    runContext: input.runContext,
                }),
            ...(sessionId !== undefined ? { sessionId } : {}),
            source,
            toolName: input.toolName,
        });
        if (approvalGate.kind === 'ready') {
            return { kind: 'ready', call };
        }

        return await this.prepareApprovalRequiredToolCall({
            approvalGate,
            args: validatedArgs,
            call,
            ...(callDescription !== undefined ? { callDescription } : {}),
            ...(input.runContext !== undefined ? { runContext: input.runContext } : {}),
            ...(sessionId !== undefined ? { sessionId } : {}),
            toolCallId: input.toolCallId,
            toolName: input.toolName,
        });
    }

    private async prepareApprovalRequiredToolCall(input: {
        approvalGate: Extract<ToolApprovalGate, { kind: 'approval-required' }>;
        args: Record<string, unknown>;
        call: ExecutableToolCall;
        callDescription?: string | undefined;
        runContext?: AgentRunContext | undefined;
        sessionId?: string | undefined;
        toolCallId: string;
        toolName: string;
    }): Promise<ApprovalRequiredPreparedToolCall> {
        const displayPreview = await this.toolPresentation.preview({
            args: input.args,
            ...(input.runContext !== undefined ? { runContext: input.runContext } : {}),
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            toolCallId: input.toolCallId,
            toolName: input.toolName,
        });
        const hostRuntime = input.runContext?.hostRuntime;
        const requestDetails: ApprovalRequestDetails = {
            type: ApprovalType.TOOL_APPROVAL,
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(hostRuntime !== undefined ? { hostRuntime } : {}),
            metadata: {
                toolName: input.toolName,
                ...(input.approvalGate.approvalKey !== undefined
                    ? { approvalKey: input.approvalGate.approvalKey }
                    : {}),
                presentationSnapshot: input.call.presentationSnapshot,
                toolCallId: input.toolCallId,
                args: input.args,
                ...(input.callDescription !== undefined
                    ? { description: input.callDescription }
                    : {}),
                ...(displayPreview !== undefined ? { displayPreview } : {}),
            },
        };

        return {
            kind: 'approval-required',
            call: input.call,
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
        decision: ApprovalDecisionInput
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

        await this.applyApprovalGrantedEffects(recorded.prepared, record.response);
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

        if (!isDeepStrictEqual(grantedDetails, approvalDetails)) {
            throw ToolError.executionFailed(
                prepared.call.toolName,
                'Approval granted-effects request does not match the prepared tool call'
            );
        }
    }

    private async applyApprovalGrantedEffects(
        prepared: ApprovalRequiredPreparedToolCall,
        response: ApprovalResponse
    ): Promise<void> {
        const approvalRequestDetails = prepared.requestDetails;
        const sessionId = approvalRequestDetails.sessionId;

        if (approvalRequestDetails.type === ApprovalType.TOOL_APPROVAL) {
            const toolMetadata = ToolApprovalMetadataSchema.parse(approvalRequestDetails.metadata);
            const approvalKey = toolMetadata.approvalKey;
            const data = response.data
                ? ToolApprovalResponseDataSchema.parse(response.data)
                : undefined;
            if (approvalKey !== undefined) {
                await this.approvalManager.addApprovedKey(
                    approvalKey,
                    data?.rememberChoice ? 'session' : 'once',
                    sessionId
                );
            }
            if (!data) {
                return;
            }
            await this.handleRememberChoice(
                prepared.call.toolName,
                {
                    data,
                    ...(response.sessionId !== undefined ? { sessionId: response.sessionId } : {}),
                },
                approvalKey,
                sessionId
            );
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
                presentationSnapshot: this.toolPresentation.buildGenericSnapshot(toolName),
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
            applied = await this.applyApprovalDecision(recorded, {
                approvalId: response.approvalId,
                status: response.status,
                ...(response.reason !== undefined ? { reason: response.reason } : {}),
                ...(response.message !== undefined ? { message: response.message } : {}),
                ...(response.timeoutMs !== undefined ? { timeoutMs: response.timeoutMs } : {}),
                ...(response.data !== undefined ? { data: response.data } : {}),
            });
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
            presentationSnapshot: this.toolPresentation.snapshotForToolCallEvent({
                toolName: call.toolName,
                args: call.input,
                toolCallId: call.toolCallId,
                sessionId,
                ...(runContext !== undefined ? { runContext } : {}),
            }),
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

            const presentationSnapshot = await this.toolPresentation.augmentWithResult({
                toolName: call.toolName,
                snapshot: call.presentationSnapshot,
                result,
                args: toolArgs,
                toolCallId: call.toolCallId,
                ...(sessionId !== undefined ? { sessionId } : {}),
                ...(runContext !== undefined ? { runContext } : {}),
            });

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
            matchesToolPolicyPattern(toolName, pattern)
        );
    }

    /**
     * Handle "remember" actions when user approves a tool.
     */
    private async handleRememberChoice(
        toolName: string,
        response: {
            data?: ToolApprovalResponseData | undefined;
            sessionId?: string | undefined;
        },
        approvalKey?: string,
        sessionId?: string
    ): Promise<void> {
        const data = response.data;
        if (!data) return;

        const rememberChoice = data.rememberChoice;

        if (rememberChoice) {
            const allowSessionId = sessionId ?? response.sessionId;
            if (approvalKey !== undefined) {
                this.autoApprovePendingApprovalKeyRequests(approvalKey, allowSessionId);
            } else {
                await this.allowedToolsProvider.allowTool(toolName, allowSessionId);
                this.logger.info(
                    `Tool '${toolName}' added to allowed tools for session '${allowSessionId ?? 'global'}' (remember choice selected)`
                );
                this.autoApprovePendingToolRequests(toolName, allowSessionId);
            }
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
}
