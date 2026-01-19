import { MCPManager } from '../mcp/manager.js';
import { InternalToolsProvider } from './internal-tools/provider.js';
import { InternalToolsServices } from './internal-tools/registry.js';
import type { InternalToolsConfig, CustomToolsConfig, ToolPolicies } from './schemas.js';
import { ToolSet, ToolExecutionContext } from './types.js';
import type { ToolDisplayData } from './display-types.js';
import { ToolError } from './errors.js';
import { ToolErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { AgentEventBus } from '../events/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import type { IAllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import type { PluginManager } from '../plugins/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../plugins/types.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import {
    generateBashPatternKey,
    generateBashPatternSuggestions,
    isDangerousCommand,
} from './bash-pattern-utils.js';
/**
 * Options for internal tools configuration in ToolManager
 */
export interface InternalToolsOptions {
    internalToolsServices?: InternalToolsServices;
    internalToolsConfig?: InternalToolsConfig;
    customToolsConfig?: CustomToolsConfig;
}

/**
 * Unified Tool Manager - Single interface for all tool operations
 *
 * This class acts as the single point of contact between the LLM and all tool sources.
 * It aggregates tools from MCP servers and internal tools, providing a unified interface
 * for tool discovery, aggregation, and execution.
 *
 * Responsibilities:
 * - Aggregate tools from MCP servers and internal tools with conflict resolution
 * - Route tool execution to appropriate source (MCP vs Internal)
 * - Provide unified tool interface to LLM
 * - Manage tool confirmation and security via ApprovalManager
 * - Handle cross-source naming conflicts (internal tools have precedence)
 *
 * Architecture:
 * LLMService → ToolManager → [MCPManager, InternalToolsProvider]
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
    private internalToolsProvider?: InternalToolsProvider;
    private approvalManager: ApprovalManager;
    private allowedToolsProvider: IAllowedToolsProvider;
    private approvalMode: 'manual' | 'auto-approve' | 'auto-deny';
    private agentEventBus: AgentEventBus;
    private toolPolicies: ToolPolicies | undefined;

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
    private logger: IDextoLogger;

    constructor(
        mcpManager: MCPManager,
        approvalManager: ApprovalManager,
        allowedToolsProvider: IAllowedToolsProvider,
        approvalMode: 'manual' | 'auto-approve' | 'auto-deny',
        agentEventBus: AgentEventBus,
        toolPolicies: ToolPolicies,
        options: InternalToolsOptions,
        logger: IDextoLogger
    ) {
        this.mcpManager = mcpManager;
        this.approvalManager = approvalManager;
        this.allowedToolsProvider = allowedToolsProvider;
        this.approvalMode = approvalMode;
        this.agentEventBus = agentEventBus;
        this.toolPolicies = toolPolicies;
        this.logger = logger.createChild(DextoLogComponent.TOOLS);

        // Initialize internal tools and/or custom tools if configured
        if (
            (options?.internalToolsConfig && options.internalToolsConfig.length > 0) ||
            (options?.customToolsConfig && options.customToolsConfig.length > 0)
        ) {
            // Include approvalManager in services for internal tools
            const internalToolsServices = {
                ...options.internalToolsServices,
                approvalManager,
            };
            this.internalToolsProvider = new InternalToolsProvider(
                internalToolsServices,
                options.internalToolsConfig || [],
                options.customToolsConfig || [],
                this.logger
            );
        }

        // Set up event listeners for surgical cache updates
        this.setupNotificationListeners();

        this.logger.debug('ToolManager initialized');
    }

    /**
     * Initialize the ToolManager and its components
     */
    async initialize(): Promise<void> {
        if (this.internalToolsProvider) {
            await this.internalToolsProvider.initialize();
        }
        this.logger.debug('ToolManager initialization complete');
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

    /**
     * Set agent reference for custom tools (called after construction to avoid circular dependencies)
     * Must be called before initialize() if custom tools are configured
     */
    setAgent(agent: any): void {
        if (this.internalToolsProvider) {
            this.internalToolsProvider.setAgent(agent);
            this.logger.debug('Agent reference configured for custom tools');
        }
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
        let internalTools: ToolSet = {};
        let customTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            this.logger.error(
                `Failed to get MCP tools: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        try {
            internalTools = this.internalToolsProvider?.getInternalTools() || {};
        } catch (error) {
            this.logger.error(
                `Failed to get internal tools: ${error instanceof Error ? error.message : String(error)}`
            );
            internalTools = {};
        }

        try {
            customTools = this.internalToolsProvider?.getCustomTools() || {};
        } catch (error) {
            this.logger.error(
                `Failed to get custom tools: ${error instanceof Error ? error.message : String(error)}`
            );
            customTools = {};
        }

        // Add internal tools with 'internal--' prefix
        for (const [toolName, toolDef] of Object.entries(internalTools)) {
            const qualifiedName = `${ToolManager.INTERNAL_TOOL_PREFIX}${toolName}`;
            allTools[qualifiedName] = {
                ...toolDef,
                name: qualifiedName,
                description: `${toolDef.description || 'No description provided'} (internal tool)`,
            };
        }

        // Add custom tools with 'custom--' prefix
        for (const [toolName, toolDef] of Object.entries(customTools)) {
            const qualifiedName = `${ToolManager.CUSTOM_TOOL_PREFIX}${toolName}`;
            allTools[qualifiedName] = {
                ...toolDef,
                name: qualifiedName,
                description: `${toolDef.description || 'No description provided'} (custom tool)`,
            };
        }

        // Add MCP tools with 'mcp--' prefix
        for (const [toolName, toolDef] of Object.entries(mcpTools)) {
            const qualifiedName = `${ToolManager.MCP_TOOL_PREFIX}${toolName}`;
            allTools[qualifiedName] = {
                ...toolDef,
                name: qualifiedName,
                description: `${toolDef.description || 'No description provided'} (via MCP servers)`,
            };
        }

        const totalTools = Object.keys(allTools).length;
        const mcpCount = Object.keys(mcpTools).length;
        const internalCount = Object.keys(internalTools).length;
        const customCount = Object.keys(customTools).length;

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
        this.logger.debug(`🔧 Tool execution requested: '${toolName}' (toolCallId: ${toolCallId})`);
        this.logger.debug(`Tool args: ${JSON.stringify(args, null, 2)}`);

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
                args,
                callId: toolCallId,
                sessionId,
            });
        }

        // Handle approval/confirmation flow - returns whether approval was required
        const { requireApproval, approvalStatus } = await this.handleToolApproval(
            toolName,
            args,
            toolCallId,
            sessionId
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
                args,
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
            args = modifiedPayload.args;
        }

        try {
            let result: unknown;

            // Route to MCP tools
            if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
                this.logger.debug(`🔧 Detected MCP tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                this.logger.debug(`🎯 MCP routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.mcpManager.executeTool(actualToolName, args, sessionId);
            }
            // Route to internal tools
            else if (toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)) {
                this.logger.debug(`🔧 Detected internal tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.INTERNAL_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                if (!this.internalToolsProvider) {
                    throw ToolError.internalToolsNotInitialized(toolName);
                }
                this.logger.debug(`🎯 Internal routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.internalToolsProvider.executeTool(
                    actualToolName,
                    args,
                    sessionId,
                    abortSignal,
                    toolCallId
                );
            }
            // Route to custom tools
            else if (toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)) {
                this.logger.debug(`🔧 Detected custom tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.CUSTOM_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                if (!this.internalToolsProvider) {
                    throw ToolError.internalToolsNotInitialized(toolName);
                }
                this.logger.debug(`🎯 Custom routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.internalToolsProvider.executeTool(
                    actualToolName,
                    args,
                    sessionId,
                    abortSignal,
                    toolCallId
                );
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

        // Check internal tools
        if (toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)) {
            const actualToolName = toolName.substring(ToolManager.INTERNAL_TOOL_PREFIX.length);
            return this.internalToolsProvider?.hasInternalTool(actualToolName) ?? false;
        }

        // Check custom tools
        if (toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)) {
            const actualToolName = toolName.substring(ToolManager.CUSTOM_TOOL_PREFIX.length);
            return this.internalToolsProvider?.hasCustomTool(actualToolName) ?? false;
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
        let internalTools: ToolSet = {};
        let customTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            this.logger.error(
                `Failed to get MCP tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        try {
            internalTools = this.internalToolsProvider?.getInternalTools() || {};
        } catch (error) {
            this.logger.error(
                `Failed to get internal tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            internalTools = {};
        }

        try {
            customTools = this.internalToolsProvider?.getCustomTools() || {};
        } catch (error) {
            this.logger.error(
                `Failed to get custom tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            customTools = {};
        }

        const mcpCount = Object.keys(mcpTools).length;
        const internalCount = Object.keys(internalTools).length;
        const customCount = Object.keys(customTools).length;

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
        // Get the actual tool name without prefix
        let actualToolName: string | undefined;
        if (toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)) {
            actualToolName = toolName.substring(ToolManager.INTERNAL_TOOL_PREFIX.length);
        } else if (toolName.startsWith(ToolManager.CUSTOM_TOOL_PREFIX)) {
            actualToolName = toolName.substring(ToolManager.CUSTOM_TOOL_PREFIX.length);
        }

        if (!actualToolName || !this.internalToolsProvider) {
            return { handled: false };
        }

        // Get the tool and check if it has custom approval override
        const tool = this.internalToolsProvider.getTool(actualToolName);
        if (!tool?.getApprovalOverride) {
            return { handled: false };
        }

        // Get the custom approval request from the tool
        const approvalRequest = tool.getApprovalOverride(args);
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
                tool.onApprovalGranted(response);
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
     * Handle tool approval/confirmation flow
     * Checks allowed list, manages approval modes (manual, auto-approve, auto-deny),
     * and handles remember choice logic
     *
     * @param toolName The fully qualified tool name
     * @param args The arguments for the tool
     * @param toolCallId The unique tool call ID for tracking parallel tool calls
     * @param sessionId Optional session ID for context
     */
    private async handleToolApproval(
        toolName: string,
        args: Record<string, unknown>,
        toolCallId: string,
        sessionId?: string
    ): Promise<{ requireApproval: boolean; approvalStatus?: 'approved' | 'rejected' }> {
        // PRECEDENCE 1: Check static alwaysDeny list (highest priority - security-first)
        if (this.isInAlwaysDenyList(toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in static deny list – blocking execution (session: ${sessionId ?? 'global'})`
            );
            this.logger.debug(`🚫 Tool execution blocked by policy: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // PRECEDENCE 1.5: Check if tool has custom approval override (e.g., directory access for file tools)
        // This allows tools to request specialized approval flows instead of default tool confirmation
        const customApprovalResult = await this.checkCustomApprovalOverride(
            toolName,
            args,
            sessionId
        );
        if (customApprovalResult.handled) {
            // Custom approval was handled (approved or threw an error)
            return { requireApproval: true, approvalStatus: 'approved' };
        }

        // PRECEDENCE 2: Check static alwaysAllow list
        if (this.isInAlwaysAllowList(toolName)) {
            this.logger.info(
                `Tool '${toolName}' is in static allow list – skipping confirmation (session: ${sessionId ?? 'global'})`
            );
            return { requireApproval: false };
        }

        // PRECEDENCE 3: Check dynamic "remembered" allowed list
        const isAllowed = await this.allowedToolsProvider.isToolAllowed(toolName, sessionId);

        if (isAllowed) {
            this.logger.info(
                `Tool '${toolName}' already allowed for session '${sessionId ?? 'global'}' – skipping confirmation.`
            );
            return { requireApproval: false };
        }

        // PRECEDENCE 3.5: Check bash command patterns (for bash_exec tool)
        let bashPatternResult: { approved: boolean; suggestedPatterns?: string[] } | undefined;
        if (this.isBashTool(toolName)) {
            const command = args.command as string | undefined;
            if (command) {
                bashPatternResult = this.checkBashPatternApproval(command);
                if (bashPatternResult.approved) {
                    this.logger.info(
                        `Bash command '${command}' matched approved pattern – skipping confirmation.`
                    );
                    return { requireApproval: false };
                }
            }
        }

        // PRECEDENCE 4: Fall back to approval mode
        // Handle different approval modes
        if (this.approvalMode === 'auto-approve') {
            this.logger.debug(`🟢 Auto-approving tool execution: ${toolName}`);
            return { requireApproval: false };
        }

        if (this.approvalMode === 'auto-deny') {
            this.logger.debug(`🚫 Auto-denying tool execution: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // Manual mode - request approval
        this.logger.info(
            `Tool confirmation requested for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        try {
            // Generate preview for approval UI (if tool supports it)
            let displayPreview: ToolDisplayData | undefined;
            // Strip prefix to get the base tool name for tool lookup
            // Tools are registered by base name (e.g., 'edit_file') but exposed with prefixes:
            // - 'internal--' for built-in internal tools
            // - 'custom--' for custom tools (filesystem tools, bash tools, etc.)
            const actualToolName = toolName.replace(/^internal--/, '').replace(/^custom--/, '');
            const internalTool = this.internalToolsProvider?.getTool(actualToolName);

            if (internalTool?.generatePreview) {
                try {
                    const context: ToolExecutionContext = { sessionId, toolCallId };
                    const preview = await internalTool.generatePreview(args, context);
                    displayPreview = preview ?? undefined;
                    this.logger.debug(`Generated preview for ${toolName}`);
                } catch (previewError) {
                    // VALIDATION_FAILED errors should fail before approval (file not found, string not found, etc.)
                    if (
                        previewError instanceof DextoRuntimeError &&
                        previewError.code === ToolErrorCode.VALIDATION_FAILED
                    ) {
                        this.logger.debug(
                            `Validation failed for ${toolName}: ${previewError.message}`
                        );
                        throw previewError;
                    }
                    // Other errors (unexpected exceptions) should not block approval
                    this.logger.debug(
                        `Preview generation failed for ${toolName}: ${previewError instanceof Error ? previewError.message : String(previewError)}`
                    );
                }
            }

            // Request approval through the ApprovalManager
            const requestData: {
                toolName: string;
                toolCallId: string;
                args: Record<string, unknown>;
                sessionId?: string;
                displayPreview?: ToolDisplayData;
                suggestedPatterns?: string[];
            } = {
                toolName,
                toolCallId,
                args,
            };

            if (sessionId !== undefined) {
                requestData.sessionId = sessionId;
            }

            if (displayPreview !== undefined) {
                requestData.displayPreview = displayPreview;
            }

            // Add suggested patterns for bash commands
            if (
                bashPatternResult?.suggestedPatterns &&
                bashPatternResult.suggestedPatterns.length > 0
            ) {
                requestData.suggestedPatterns = bashPatternResult.suggestedPatterns;
            }

            const response = await this.approvalManager.requestToolConfirmation(requestData);

            // Handle remember choice / pattern if approved
            if (response.status === ApprovalStatus.APPROVED && response.data) {
                const rememberChoice =
                    'rememberChoice' in response.data ? response.data.rememberChoice : false;
                const rememberPattern =
                    'rememberPattern' in response.data ? response.data.rememberPattern : undefined;

                if (rememberChoice) {
                    // Remember the entire tool for the session
                    // Use the request's sessionId to ensure permission is stored for the correct session
                    // Fall back to response.sessionId only if request didn't specify one
                    const allowSessionId = sessionId ?? response.sessionId;
                    await this.allowedToolsProvider.allowTool(toolName, allowSessionId);
                    this.logger.info(
                        `Tool '${toolName}' added to allowed tools for session '${allowSessionId ?? 'global'}' (remember choice selected)`
                    );
                } else if (
                    rememberPattern &&
                    typeof rememberPattern === 'string' &&
                    this.isBashTool(toolName)
                ) {
                    // Remember a specific bash command pattern (only for bash tools)
                    this.approvalManager.addBashPattern(rememberPattern);
                    this.logger.info(
                        `Bash pattern '${rememberPattern}' added for session approval`
                    );
                }
            }

            const approved = response.status === ApprovalStatus.APPROVED;

            if (!approved) {
                // Distinguish between timeout, cancellation, and actual denial
                if (response.status === ApprovalStatus.CANCELLED && response.reason === 'timeout') {
                    this.logger.info(
                        `Tool confirmation timed out for ${toolName}, sessionId: ${sessionId ?? 'global'}`
                    );
                    this.logger.debug(`⏱️ Tool execution timed out: ${toolName}`);
                    // Use timeout value from response if available, otherwise fallback to 0
                    const timeoutMs = response.timeoutMs ?? 0;
                    throw ToolError.executionTimeout(toolName, timeoutMs, sessionId);
                }

                // All other non-approved statuses (denied, cancelled for other reasons)
                this.logger.info(
                    `Tool confirmation denied for ${toolName}, sessionId: ${sessionId ?? 'global'}, reason: ${response.reason ?? 'unknown'}`
                );
                this.logger.debug(`🚫 Tool execution denied: ${toolName}`);
                throw ToolError.executionDenied(toolName, sessionId);
            }

            this.logger.info(
                `Tool confirmation approved for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );

            // Return approval metadata
            return { requireApproval: true, approvalStatus: 'approved' };
        } catch (error) {
            // Log and re-throw - errors are already properly formatted by ApprovalManager
            this.logger.error(
                `Tool confirmation error for ${toolName}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
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
