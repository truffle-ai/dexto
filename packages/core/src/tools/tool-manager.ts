import { MCPManager } from '../mcp/manager.js';
import { InternalToolsProvider } from './internal-tools/provider.js';
import { InternalToolsServices } from './internal-tools/registry.js';
import type { InternalToolsConfig, ToolPolicies } from './schemas.js';
import { ToolSet } from './types.js';
import { ToolError } from './errors.js';
import { logger } from '../logger/index.js';
import type { AgentEventBus } from '../events/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import type { IAllowedToolsProvider } from './confirmation/allowed-tools-provider/types.js';
import type { PluginManager } from '../plugins/manager.js';
import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { BeforeToolCallPayload, AfterToolResultPayload } from '../plugins/types.js';

/**
 * Options for internal tools configuration in ToolManager
 */
export interface InternalToolsOptions {
    internalToolsServices?: InternalToolsServices;
    internalToolsConfig?: InternalToolsConfig;
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
 */
export class ToolManager {
    private mcpManager: MCPManager;
    private internalToolsProvider?: InternalToolsProvider;
    private approvalManager: ApprovalManager;
    private allowedToolsProvider: IAllowedToolsProvider;
    private approvalMode: 'event-based' | 'auto-approve' | 'auto-deny';
    private agentEventBus: AgentEventBus;
    private toolPolicies: ToolPolicies | undefined;

    // Plugin support - set after construction to avoid circular dependencies
    private pluginManager?: PluginManager;
    private sessionManager?: SessionManager;
    private stateManager?: AgentStateManager;

    // Tool source prefixing - ALL tools get prefixed by source
    private static readonly MCP_TOOL_PREFIX = 'mcp--';
    private static readonly INTERNAL_TOOL_PREFIX = 'internal--';

    // Tool caching for performance
    private toolsCache: ToolSet = {};
    private cacheValid: boolean = false;

    constructor(
        mcpManager: MCPManager,
        approvalManager: ApprovalManager,
        allowedToolsProvider: IAllowedToolsProvider,
        approvalMode: 'event-based' | 'auto-approve' | 'auto-deny',
        agentEventBus: AgentEventBus,
        toolPolicies?: ToolPolicies,
        options?: InternalToolsOptions
    ) {
        this.mcpManager = mcpManager;
        this.approvalManager = approvalManager;
        this.allowedToolsProvider = allowedToolsProvider;
        this.approvalMode = approvalMode;
        this.agentEventBus = agentEventBus;
        this.toolPolicies = toolPolicies;

        // Initialize internal tools if configured
        if (options?.internalToolsConfig && options.internalToolsConfig.length > 0) {
            this.internalToolsProvider = new InternalToolsProvider(
                options.internalToolsServices || {},
                approvalManager,
                options.internalToolsConfig
            );
        }

        // Set up event listeners for surgical cache updates
        this.setupNotificationListeners();

        logger.debug('ToolManager initialized');
    }

    /**
     * Initialize the ToolManager and its components
     */
    async initialize(): Promise<void> {
        if (this.internalToolsProvider) {
            await this.internalToolsProvider.initialize();
        }
        logger.debug('ToolManager initialization complete');
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
        logger.debug('Plugin support configured for ToolManager');
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
        this.agentEventBus.on('dexto:mcpServerConnected', async (payload) => {
            if (payload.success) {
                logger.debug(`🔄 MCP server connected, invalidating tool cache: ${payload.name}`);
                this.invalidateCache();
            }
        });

        this.agentEventBus.on('dexto:mcpServerRemoved', async (payload) => {
            logger.debug(`🔄 MCP server removed: ${payload.serverName}, invalidating tool cache`);
            this.invalidateCache();
        });
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

        // Get tools from both sources (already in final JSON Schema format)
        let mcpTools: ToolSet = {};
        let internalTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            logger.error(
                `Failed to get MCP tools: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        try {
            internalTools = this.internalToolsProvider?.getAllTools() || {};
        } catch (error) {
            logger.error(
                `Failed to get internal tools: ${error instanceof Error ? error.message : String(error)}`
            );
            internalTools = {};
        }

        // Add ALL internal tools with prefix
        for (const [toolName, toolDef] of Object.entries(internalTools)) {
            const qualifiedName = `${ToolManager.INTERNAL_TOOL_PREFIX}${toolName}`;
            allTools[qualifiedName] = {
                ...toolDef,
                name: qualifiedName,
                description: `${toolDef.description || 'No description provided'} (internal tool)`,
            };
        }

        // Add ALL MCP tools with prefix
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

        logger.debug(
            `🔧 Unified tool discovery: ${totalTools} total tools (${mcpCount} MCP → ${ToolManager.MCP_TOOL_PREFIX}*, ${internalCount} internal → ${ToolManager.INTERNAL_TOOL_PREFIX}*)`
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
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<unknown> {
        logger.debug(`🔧 Tool execution requested: '${toolName}'`);
        logger.debug(`Tool args: ${JSON.stringify(args, null, 2)}`);

        // Handle approval/confirmation flow
        await this.handleToolApproval(toolName, args, sessionId);

        logger.debug(`✅ Tool execution approved: ${toolName}`);
        logger.info(
            `🔧 Tool execution started for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

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
                logger.debug(`🔧 Detected MCP tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                logger.debug(`🎯 MCP routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.mcpManager.executeTool(actualToolName, args, sessionId);
            }
            // Route to internal tools
            else if (toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)) {
                logger.debug(`🔧 Detected internal tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.INTERNAL_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                if (!this.internalToolsProvider) {
                    throw ToolError.internalToolsNotInitialized(toolName);
                }
                logger.debug(`🎯 Internal routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.internalToolsProvider.executeTool(
                    actualToolName,
                    args,
                    sessionId
                );
            }
            // Tool doesn't have proper prefix
            // TODO: will update for custom tools
            else {
                logger.debug(`🔧 Detected tool without proper prefix: '${toolName}'`);
                const stats = await this.getToolStats();
                logger.error(
                    `❌ Tool missing source prefix: '${toolName}' (expected '${ToolManager.MCP_TOOL_PREFIX}*' or '${ToolManager.INTERNAL_TOOL_PREFIX}*')`
                );
                logger.debug(`Available: ${stats.mcp} MCP tools, ${stats.internal} internal tools`);
                throw ToolError.notFound(toolName);
            }

            const duration = Date.now() - startTime;
            logger.debug(`🎯 Tool execution completed in ${duration}ms: '${toolName}'`);
            logger.info(
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

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(
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
            return this.internalToolsProvider?.hasTool(actualToolName) ?? false;
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
    }> {
        let mcpTools: ToolSet = {};
        let internalTools: ToolSet = {};

        try {
            mcpTools = await this.mcpManager.getAllTools();
        } catch (error) {
            logger.error(
                `Failed to get MCP tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpTools = {};
        }

        try {
            internalTools = this.internalToolsProvider?.getAllTools() || {};
        } catch (error) {
            logger.error(
                `Failed to get internal tools for stats: ${error instanceof Error ? error.message : String(error)}`
            );
            internalTools = {};
        }

        const mcpCount = Object.keys(mcpTools).length;
        const internalCount = Object.keys(internalTools).length;

        return {
            total: mcpCount + internalCount, // No conflicts with universal prefixing
            mcp: mcpCount,
            internal: internalCount,
        };
    }

    /**
     * Get the source of a tool (mcp, internal, or unknown)
     * @param toolName The name of the tool to check
     * @returns The source of the tool
     */
    getToolSource(toolName: string): 'mcp' | 'internal' | 'unknown' {
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
     * Handle tool approval/confirmation flow
     * Checks allowed list, manages approval modes (event-based, auto-approve, auto-deny),
     * and handles remember choice logic
     */
    private async handleToolApproval(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<void> {
        // PRECEDENCE 1: Check static alwaysDeny list (highest priority - security-first)
        if (this.isInAlwaysDenyList(toolName)) {
            logger.info(
                `Tool '${toolName}' is in static deny list – blocking execution (session: ${sessionId ?? 'global'})`
            );
            logger.debug(`🚫 Tool execution blocked by policy: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // PRECEDENCE 2: Check static alwaysAllow list
        if (this.isInAlwaysAllowList(toolName)) {
            logger.info(
                `Tool '${toolName}' is in static allow list – skipping confirmation (session: ${sessionId ?? 'global'})`
            );
            return;
        }

        // PRECEDENCE 3: Check dynamic "remembered" allowed list
        const isAllowed = await this.allowedToolsProvider.isToolAllowed(toolName, sessionId);

        if (isAllowed) {
            logger.info(
                `Tool '${toolName}' already allowed for session '${sessionId ?? 'global'}' – skipping confirmation.`
            );
            return;
        }

        // PRECEDENCE 4: Fall back to approval mode
        // Handle different approval modes
        if (this.approvalMode === 'auto-approve') {
            logger.debug(`🟢 Auto-approving tool execution: ${toolName}`);
            return;
        }

        if (this.approvalMode === 'auto-deny') {
            logger.debug(`🚫 Auto-denying tool execution: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        // Event-based mode - request approval
        logger.info(
            `Tool confirmation requested for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        try {
            // Request approval through the ApprovalManager
            const requestData: {
                toolName: string;
                args: Record<string, unknown>;
                sessionId?: string;
            } = {
                toolName,
                args,
            };

            if (sessionId !== undefined) {
                requestData.sessionId = sessionId;
            }

            const response = await this.approvalManager.requestToolConfirmation(requestData);

            // Handle remember choice if approved
            const rememberChoice =
                response.data && 'rememberChoice' in response.data
                    ? response.data.rememberChoice
                    : false;

            if (response.status === ApprovalStatus.APPROVED && rememberChoice) {
                // Use the request's sessionId to ensure permission is stored for the correct session
                // Fall back to response.sessionId only if request didn't specify one
                const allowSessionId = sessionId ?? response.sessionId;
                await this.allowedToolsProvider.allowTool(toolName, allowSessionId);
                logger.info(
                    `Tool '${toolName}' added to allowed tools for session '${allowSessionId ?? 'global'}' (remember choice selected)`
                );
            }

            const approved = response.status === ApprovalStatus.APPROVED;

            if (!approved) {
                logger.info(
                    `Tool confirmation denied for ${toolName}, sessionId: ${sessionId ?? 'global'}`
                );
                logger.debug(`🚫 Tool execution denied: ${toolName}`);
                throw ToolError.executionDenied(toolName, sessionId);
            }

            logger.info(
                `Tool confirmation approved for ${toolName}, sessionId: ${sessionId ?? 'global'}`
            );
        } catch (error) {
            // Log and re-throw - errors are already properly formatted by ApprovalManager
            logger.error(
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

        logger.debug('ToolManager refreshed (including MCP server capabilities)');
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
