import { MCPManager } from '../mcp/manager.js';
import type { ToolPolicies } from './schemas.js';
import { ToolSet, ToolExecutionContext, Tool } from './types.js';
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
import type { ApprovalRequest, ToolConfirmationMetadata } from '../approval/types.js';
import type { AllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import type { PluginManager } from '../plugins/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../plugins/types.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import { extractToolCallMeta, wrapToolParametersSchema } from './tool-call-metadata.js';
import {
    generateBashPatternKey,
    generateBashPatternSuggestions,
    isDangerousCommand,
} from './bash-pattern-utils.js';
import { isBackgroundTasksEnabled } from '../utils/env.js';

export type ToolExecutionContextFactory = (
    baseContext: ToolExecutionContext
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
 * - Manage tool confirmation and security via ApprovalManager
 * - Handle cross-source naming conflicts (internal tools have precedence)
 *
 * Architecture:
 * LLMService → ToolManager → [MCPManager, local tools]
 *                ↓
 *          ApprovalManager (for confirmations)
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
    excludeMethods: [
        'setPluginManager',
        'setStateManager',
        'getApprovalManager',
        'getAllowedToolsProvider',
    ],
})
export class ToolManager {
    private mcpManager: MCPManager;
    private agentTools: Map<string, Tool> = new Map();
    private approvalManager: ApprovalManager;
    private allowedToolsProvider: AllowedToolsProvider;
    private approvalMode: 'manual' | 'auto-approve' | 'auto-deny';
    private agentEventBus: AgentEventBus;
    private toolPolicies: ToolPolicies | undefined;
    private toolExecutionContextFactory?: ToolExecutionContextFactory;

    // Plugin support - set after construction to avoid circular dependencies
    private pluginManager?: PluginManager;
    private sessionManager?: SessionManager;
    private stateManager?: AgentStateManager;

    // Tool source prefixing - ALL tools get prefixed by source
    private static readonly MCP_TOOL_PREFIX = 'mcp--';
    private static readonly INTERNAL_TOOL_PREFIX = 'internal--';
    private static readonly CUSTOM_TOOL_PREFIX = 'custom--';

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

    setToolExecutionContextFactory(factory: ToolExecutionContextFactory): void {
        this.toolExecutionContextFactory = factory;
    }

    /**
     * Set plugin support services (called after construction to avoid circular dependencies)
     */
    setPluginSupport(
        pluginManager: PluginManager,
        sessionManager: SessionManager,
        stateManager: AgentStateManager
    ): void {
        this.pluginManager = pluginManager;
        this.sessionManager = sessionManager;
        this.stateManager = stateManager;
        this.logger.debug('Plugin support configured for ToolManager');
    }

    // ============= SESSION AUTO-APPROVE TOOLS =============

    /**
     * Set session-level auto-approve tools.
     * When set, these tools will skip confirmation prompts for this session.
     * This is ADDITIVE - other tools are NOT blocked, they just go through normal approval flow.
     *
     * @param sessionId The session ID
     * @param autoApproveTools Array of tool names to auto-approve (e.g., ['custom--bash_exec', 'custom--read_file'])
     */
    setSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        // Empty array = no auto-approvals, same as clearing
        if (autoApproveTools.length === 0) {
            this.clearSessionAutoApproveTools(sessionId);
            return;
        }
        this.sessionAutoApproveTools.set(sessionId, autoApproveTools);
        this.logger.info(
            `Session auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`Auto-approve tools: ${autoApproveTools.join(', ')}`);
    }

    /**
     * Set session-level auto-approve tools chosen by the user.
     */
    setSessionUserAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        if (autoApproveTools.length === 0) {
            this.clearSessionUserAutoApproveTools(sessionId);
            return;
        }
        this.sessionUserAutoApproveTools.set(sessionId, autoApproveTools);
        this.logger.info(
            `Session user auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`User auto-approve tools: ${autoApproveTools.join(', ')}`);
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

    // ==================== Bash Pattern Approval Helpers ====================

    /**
     * Check if a tool name represents a bash execution tool
     */
    private isBashTool(toolName: string): boolean {
        return (
            toolName === 'bash_exec' ||
            toolName === 'internal--bash_exec' ||
            toolName === 'custom--bash_exec'
        );
    }

    /**
     * Check if a bash command is covered by any approved pattern.
     * Generates a pattern key from the command, then checks if it's covered by stored patterns.
     *
     * Returns approval info if covered, or pattern suggestions if not.
     */
    private checkBashPatternApproval(command: string): {
        approved: boolean;
        suggestedPatterns?: string[];
    } {
        // Generate the pattern key for this command
        const patternKey = generateBashPatternKey(command);

        if (!patternKey) {
            // Dangerous command - no pattern, require explicit approval each time
            if (isDangerousCommand(command)) {
                this.logger.debug(
                    `Skipping pattern generation for dangerous command: ${command.split(/\s+/)[0]}`
                );
            }
            return { approved: false, suggestedPatterns: [] };
        }

        // Check if this pattern key is covered by any approved pattern
        if (this.approvalManager.matchesBashPattern(patternKey)) {
            return { approved: true };
        }

        // Generate broader pattern suggestions for the UI
        return {
            approved: false,
            suggestedPatterns: generateBashPatternSuggestions(command),
        };
    }

    /**
     * Auto-approve pending tool confirmation requests for the same tool.
     * Called after a user selects "remember choice" for a tool.
     * This handles the case where parallel tool calls come in before the first one is approved.
     *
     * @param toolName The tool name that was just remembered
     * @param sessionId The session ID for which the tool was allowed
     */
    private autoApprovePendingToolRequests(toolName: string, sessionId?: string): void {
        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                // Only match tool confirmation requests
                if (request.type !== ApprovalType.TOOL_CONFIRMATION) {
                    return false;
                }

                // Only match requests for the same session
                if (request.sessionId !== sessionId) {
                    return false;
                }

                // Check if it's the same tool
                const metadata = request.metadata as ToolConfirmationMetadata;
                return metadata.toolName === toolName;
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
     * Auto-approve pending bash command requests that match a pattern.
     * Called after a user selects "remember pattern" for a bash command.
     * This handles the case where parallel bash commands come in before the first one is approved.
     *
     * @param pattern The bash pattern that was just remembered
     * @param sessionId The session ID for context
     */
    private autoApprovePendingBashRequests(pattern: string, sessionId?: string): void {
        const count = this.approvalManager.autoApprovePendingRequests(
            (request: ApprovalRequest) => {
                // Only match tool confirmation requests
                if (request.type !== ApprovalType.TOOL_CONFIRMATION) {
                    return false;
                }

                // Only match requests for the same session
                if (request.sessionId !== sessionId) {
                    return false;
                }

                // Check if it's a bash tool
                const metadata = request.metadata as ToolConfirmationMetadata;
                if (!this.isBashTool(metadata.toolName)) {
                    return false;
                }

                // Check if the command matches the pattern
                const command = metadata.args?.command as string | undefined;
                if (!command) {
                    return false;
                }

                // Generate pattern key for this command and check if it matches
                const patternKey = generateBashPatternKey(command);
                if (!patternKey) {
                    return false;
                }

                // Check if this command would now be approved with the new pattern
                // The pattern was just added, so we can use matchesBashPattern
                return this.approvalManager.matchesBashPattern(patternKey);
            },
            { rememberPattern: undefined } // Don't propagate pattern to auto-approved requests
        );

        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} parallel bash command(s) matching pattern '${pattern}'`
            );
        }
    }

    getMcpManager(): MCPManager {
        return this.mcpManager;
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
        const baseContext: ToolExecutionContext = {
            sessionId: options.sessionId,
            abortSignal: options.abortSignal,
            toolCallId: options.toolCallId,
            logger: this.logger,
        };
        return this.toolExecutionContextFactory
            ? this.toolExecutionContextFactory(baseContext)
            : baseContext;
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

        // Validate input against tool's Zod schema
        const validationResult = tool.inputSchema.safeParse(args);
        if (!validationResult.success) {
            this.logger.error(
                `❌ Invalid arguments for tool ${toolName}: ${validationResult.error.message}`
            );
            throw ToolError.invalidName(
                toolName,
                `Invalid arguments: ${validationResult.error.message}`
            );
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, abortSignal, toolCallId });
            const result = await tool.execute(validationResult.data, context);
            return result;
        } catch (error) {
            this.logger.error(`❌ Local tool execution failed: ${toolName}`, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Build all tools from sources with universal prefixing
     * ALL tools get prefixed by their source - no exceptions
     *
     * TODO: Rethink tool naming convention for more consistency
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

        // Add local tools (already fully qualified)
        for (const [qualifiedName, tool] of this.agentTools) {
            const suffix = qualifiedName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)
                ? ' (internal tool)'
                : qualifiedName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
                  ? ' (custom tool)'
                  : '';
            allTools[qualifiedName] = {
                name: qualifiedName,
                description: `${tool.description || 'No description provided'}${suffix}`,
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
        const agentTools = Array.from(this.agentTools.keys());
        const internalCount = agentTools.filter((name) =>
            name.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)
        ).length;
        const customCount = agentTools.filter((name) =>
            name.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
        ).length;

        this.logger.debug(
            `🔧 Unified tool discovery: ${totalTools} total tools (${mcpCount} MCP, ${internalCount} internal, ${customCount} custom)`
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
     * Execute a tool by routing based on universal prefix
     * ALL tools must have source prefix - no exceptions
     *
     * @param toolName The fully qualified tool name (e.g., "internal--edit_file")
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
            this.agentEventBus.emit('llm:tool-call', {
                toolName,
                args: toolArgs,
                callId: toolCallId,
                sessionId,
            });
        }

        // Handle approval/confirmation flow - returns whether approval was required
        const { requireApproval, approvalStatus } = await this.handleToolApproval(
            toolName,
            toolArgs,
            toolCallId,
            sessionId,
            meta.callDescription
        );

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

        // Execute beforeToolCall plugins if available
        if (this.pluginManager && this.sessionManager && this.stateManager) {
            const beforePayload: BeforeToolCallPayload = {
                toolName,
                args: toolArgs,
                ...(sessionId !== undefined && { sessionId }),
            };

            const modifiedPayload = await this.pluginManager.executePlugins(
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
            }
            // Route to local tools (internal + custom)
            else if (
                toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX) ||
                toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
            ) {
                const prefix = toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)
                    ? ToolManager.INTERNAL_TOOL_PREFIX
                    : ToolManager.CUSTOM_TOOL_PREFIX;
                const actualToolName = toolName.substring(prefix.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }

                const toolKind =
                    prefix === ToolManager.INTERNAL_TOOL_PREFIX ? 'internal' : 'custom';
                this.logger.debug(`🔧 Detected ${toolKind} tool: '${toolName}'`);
                this.logger.debug(`🎯 ${toolKind} routing: '${toolName}' -> '${actualToolName}'`);

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
                        `${toolKind === 'internal' ? 'Internal' : 'Custom'} tool ${actualToolName}`
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
            // Tool doesn't have proper prefix
            else {
                this.logger.debug(`🔧 Detected tool without proper prefix: '${toolName}'`);
                const stats = await this.getToolStats();
                this.logger.error(
                    `❌ Tool missing source prefix: '${toolName}' (expected '${ToolManager.MCP_TOOL_PREFIX}*', '${ToolManager.INTERNAL_TOOL_PREFIX}*', or '${ToolManager.CUSTOM_TOOL_PREFIX}*')`
                );
                this.logger.debug(
                    `Available: ${stats.mcp} MCP, ${stats.internal} internal, ${stats.custom} custom tools`
                );
                throw ToolError.notFound(toolName);
            }

            const duration = Date.now() - startTime;
            this.logger.debug(`🎯 Tool execution completed in ${duration}ms: '${toolName}'`);
            this.logger.info(
                `✅ Tool execution completed successfully for ${toolName} in ${duration}ms, sessionId: ${sessionId ?? 'global'}`
            );

            // Execute afterToolResult plugins if available
            if (this.pluginManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName,
                    result,
                    success: true,
                    ...(sessionId !== undefined && { sessionId }),
                };

                const modifiedPayload = await this.pluginManager.executePlugins(
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

            return {
                result,
                ...(requireApproval && { requireApproval, approvalStatus }),
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error(
                `❌ Tool execution failed for ${toolName} after ${duration}ms, sessionId: ${sessionId ?? 'global'}: ${error instanceof Error ? error.message : String(error)}`
            );

            // Execute afterToolResult plugins for error case if available
            if (this.pluginManager && this.sessionManager && this.stateManager) {
                const afterPayload: AfterToolResultPayload = {
                    toolName,
                    result: error instanceof Error ? error.message : String(error),
                    success: false,
                    ...(sessionId !== undefined && { sessionId }),
                };

                // Note: We still execute plugins even on error, but we don't use the modified result
                // Plugins can log, track metrics, etc. but cannot suppress the error
                await this.pluginManager.executePlugins('afterToolResult', afterPayload, {
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
     * Check if a tool exists (must have proper source prefix)
     */
    async hasTool(toolName: string): Promise<boolean> {
        // Check MCP tools
        if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
            const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
            return this.mcpManager.getToolClient(actualToolName) !== undefined;
        }

        // Check local tools (internal + custom)
        if (
            toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX) ||
            toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
        ) {
            return this.agentTools.has(toolName);
        }

        // Tool without proper prefix doesn't exist
        return false;
    }

    /**
     * Get tool statistics across all sources
     */
    async getToolStats(): Promise<{
        total: number;
        mcp: number;
        internal: number;
        custom: number;
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
        const agentTools = Array.from(this.agentTools.keys());
        const internalCount = agentTools.filter((name) =>
            name.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)
        ).length;
        const customCount = agentTools.filter((name) =>
            name.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
        ).length;

        return {
            total: mcpCount + internalCount + customCount,
            mcp: mcpCount,
            internal: internalCount,
            custom: customCount,
        };
    }

    /**
     * Get the source of a tool (mcp, internal, custom, or unknown)
     * @param toolName The name of the tool to check
     * @returns The source of the tool
     */
    getToolSource(toolName: string): 'mcp' | 'internal' | 'custom' | 'unknown' {
        if (
            toolName.startsWith(ToolManager.MCP_TOOL_PREFIX) &&
            toolName.length > ToolManager.MCP_TOOL_PREFIX.length
        ) {
            return 'mcp';
        }
        if (
            toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX) &&
            toolName.length > ToolManager.INTERNAL_TOOL_PREFIX.length
        ) {
            return 'internal';
        }
        if (
            toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX) &&
            toolName.length > ToolManager.CUSTOM_TOOL_PREFIX.length
        ) {
            return 'custom';
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
     * - Policy "internal--ask_user" matches "internal--ask_user" (exact only)
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
     * Check if a tool has a custom approval override and handle it.
     * Tools can implement getApprovalOverride() to request specialized approval flows
     * (e.g., directory access approval for file tools) instead of default tool confirmation.
     *
     * @param toolName The fully qualified tool name
     * @param args The tool arguments
     * @param sessionId Optional session ID
     * @returns { handled: true } if custom approval was processed, { handled: false } to continue normal flow
     */
    private async checkCustomApprovalOverride(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<{ handled: boolean }> {
        if (
            !toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX) &&
            !toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)
        ) {
            return { handled: false };
        }

        // Get the tool and check if it has custom approval override
        const tool = this.agentTools.get(toolName);
        if (!tool?.getApprovalOverride) {
            return { handled: false };
        }

        const context = this.buildToolExecutionContext({ sessionId });

        // Get the custom approval request from the tool (may be async)
        const approvalRequest = await tool.getApprovalOverride(args, context);
        if (!approvalRequest) {
            // Tool decided no custom approval needed, continue normal flow
            return { handled: false };
        }

        this.logger.debug(
            `Tool '${toolName}' requested custom approval: type=${approvalRequest.type}`
        );

        // Add sessionId to the approval request if not already present
        if (sessionId && !approvalRequest.sessionId) {
            approvalRequest.sessionId = sessionId;
        }

        // Request the custom approval through ApprovalManager
        const response = await this.approvalManager.requestApproval(approvalRequest);

        if (response.status === ApprovalStatus.APPROVED) {
            // Let the tool handle the approved response (e.g., remember directory)
            if (tool.onApprovalGranted) {
                tool.onApprovalGranted(response, context);
            }

            this.logger.info(
                `Custom approval granted for '${toolName}', type=${approvalRequest.type}, session=${sessionId ?? 'global'}`
            );
            return { handled: true };
        }

        // Handle denial - throw appropriate error based on approval type
        this.logger.info(
            `Custom approval denied for '${toolName}', type=${approvalRequest.type}, reason=${response.reason ?? 'unknown'}`
        );

        // For directory access, throw specific error
        if (approvalRequest.type === 'directory_access') {
            const metadata = approvalRequest.metadata as { parentDir?: string } | undefined;
            throw ToolError.directoryAccessDenied(
                metadata?.parentDir ?? 'unknown directory',
                sessionId
            );
        }

        // For other custom approval types, throw generic execution denied
        throw ToolError.executionDenied(toolName, sessionId);
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
    ): Promise<{ requireApproval: boolean; approvalStatus?: 'approved' | 'rejected' }> {
        // Try quick resolution first (auto-approve/deny based on policies)
        const quickResult = await this.tryQuickApprovalResolution(toolName, args, sessionId);
        if (quickResult !== null) {
            return quickResult;
        }

        // Fall back to manual approval flow
        return this.requestManualApproval(toolName, args, toolCallId, sessionId, callDescription);
    }

    /**
     * Try to resolve tool approval quickly based on policies and cached permissions.
     * Returns null if manual approval is needed.
     *
     * Precedence order (highest to lowest):
     * 1. Static deny list (security - always blocks)
     * 2. Custom approval override (tool-specific approval flows)
     * 3. Session auto-approve (skill allowed-tools)
     * 4. Static allow list
     * 5. Dynamic "remembered" allowed list
     * 6. Bash command patterns
     * 7. Approval mode (auto-approve/auto-deny)
     */
    private async tryQuickApprovalResolution(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<{ requireApproval: boolean; approvalStatus?: 'approved' } | null> {
        // 1. Check static alwaysDeny list (highest priority - security-first)
        if (this.isInAlwaysDenyList(toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in static deny list – blocking execution (session: ${sessionId ?? 'global'})`
            );
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // 2. Check custom approval override (e.g., directory access for file tools)
        const customApprovalResult = await this.checkCustomApprovalOverride(
            toolName,
            args,
            sessionId
        );
        if (customApprovalResult.handled) {
            return { requireApproval: true, approvalStatus: 'approved' };
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

        // 6. Check bash command patterns
        if (this.isBashTool(toolName)) {
            const command = args.command as string | undefined;
            if (command) {
                const bashResult = this.checkBashPatternApproval(command);
                if (bashResult.approved) {
                    this.logger.info(
                        `Bash command '${command}' matched approved pattern – skipping confirmation.`
                    );
                    return { requireApproval: false };
                }
            }
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
        callDescription?: string
    ): Promise<{ requireApproval: boolean; approvalStatus: 'approved' | 'rejected' }> {
        this.logger.info(
            `Tool confirmation requested for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        try {
            // Generate preview for approval UI
            const displayPreview = await this.generateToolPreview(
                toolName,
                args,
                toolCallId,
                sessionId
            );

            // Get suggested bash patterns if applicable
            const suggestedPatterns = this.getBashSuggestedPatterns(toolName, args);

            // Build and send approval request
            const response = await this.approvalManager.requestToolConfirmation({
                toolName,
                toolCallId,
                args,
                ...(callDescription !== undefined && { description: callDescription }),
                ...(sessionId !== undefined && { sessionId }),
                ...(displayPreview !== undefined && { displayPreview }),
                ...(suggestedPatterns !== undefined && { suggestedPatterns }),
            });

            // Handle "remember" choices if approved
            if (response.status === ApprovalStatus.APPROVED && response.data) {
                await this.handleRememberChoice(toolName, response, sessionId);
            }

            // Process response
            if (response.status !== ApprovalStatus.APPROVED) {
                this.handleApprovalDenied(toolName, response, sessionId);
            }

            this.logger.info(
                `Tool confirmation approved for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );
            return { requireApproval: true, approvalStatus: 'approved' };
        } catch (error) {
            this.logger.error(
                `Tool confirmation error for ${toolName}: ${error instanceof Error ? error.message : String(error)}`
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
        const tool = this.agentTools.get(toolName);
        if (!tool?.generatePreview) {
            return undefined;
        }

        try {
            const context = this.buildToolExecutionContext({ sessionId, toolCallId });
            const preview = await tool.generatePreview(args, context);
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
     * Get suggested bash patterns for the approval UI.
     */
    private getBashSuggestedPatterns(
        toolName: string,
        args: Record<string, unknown>
    ): string[] | undefined {
        if (!this.isBashTool(toolName)) {
            return undefined;
        }
        const command = args.command as string | undefined;
        if (!command) {
            return undefined;
        }
        const result = this.checkBashPatternApproval(command);
        return result.suggestedPatterns?.length ? result.suggestedPatterns : undefined;
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
        } else if (rememberPattern && this.isBashTool(toolName)) {
            this.approvalManager.addBashPattern(rememberPattern);
            this.logger.info(`Bash pattern '${rememberPattern}' added for session approval`);
            this.autoApprovePendingBashRequests(rememberPattern, sessionId);
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
