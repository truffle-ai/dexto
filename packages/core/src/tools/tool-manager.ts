import { MCPManager } from '../mcp/manager.js';
import { InternalToolsProvider } from './internal-tools/provider.js';
import { InternalToolsServices } from './internal-tools/registry.js';
import type { InternalToolsConfig } from './schemas.js';
import { ToolSet } from './types.js';
import { ToolConfirmationProvider } from './confirmation/types.js';
import { ToolError } from './errors.js';
import { logger } from '../logger/index.js';
import type { HookManager, HookNotice, AfterToolResultPayload } from '../hooks/index.js';
import { runBeforeToolCall, runAfterToolResult } from '../hooks/index.js';

/**
 * Options for internal tools configuration in ToolManager
 */
export interface InternalToolsOptions {
    internalToolsServices?: InternalToolsServices;
    internalToolsConfig?: InternalToolsConfig;
    hookManager?: HookManager;
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
 * - Manage tool confirmation and security
 * - Handle cross-source naming conflicts (internal tools have precedence)
 *
 * Architecture:
 * LLMService → ToolManager → [MCPManager, InternalToolsProvider]
 */
export class ToolManager {
    private mcpManager: MCPManager;
    private internalToolsProvider?: InternalToolsProvider;
    private confirmationProvider: ToolConfirmationProvider;
    private hookManager?: HookManager;

    // Tool source prefixing - ALL tools get prefixed by source
    private static readonly MCP_TOOL_PREFIX = 'mcp--';
    private static readonly INTERNAL_TOOL_PREFIX = 'internal--';

    // Tool caching for performance
    private toolsCache: ToolSet = {};
    private cacheValid: boolean = false;

    constructor(
        mcpManager: MCPManager,
        confirmationProvider: ToolConfirmationProvider,
        options?: InternalToolsOptions
    ) {
        this.mcpManager = mcpManager;
        this.confirmationProvider = confirmationProvider;
        if (options?.hookManager) {
            this.hookManager = options.hookManager;
        }

        // Initialize internal tools if configured
        if (options?.internalToolsConfig && options.internalToolsConfig.length > 0) {
            this.internalToolsProvider = new InternalToolsProvider(
                options.internalToolsServices || {},
                confirmationProvider,
                options.internalToolsConfig
            );
        }

        logger.debug('ToolManager initialized');
    }

    private logHookNotices(context: string, notices?: HookNotice[]) {
        if (!notices || notices.length === 0) {
            return;
        }

        notices.forEach((notice) => {
            const metadata = {
                context,
                ...(notice.code && { code: notice.code }),
                ...(notice.details && { details: notice.details }),
            };

            const message = `Hook notice (${notice.kind}) - ${notice.message}`;
            if (notice.kind === 'block' || notice.kind === 'warn') {
                logger.warn(message, metadata);
            } else {
                logger.info(message, metadata);
            }
        });
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
     * Invalidate the tools cache when tool sources change
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.toolsCache = {};
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
        sessionId?: string,
        callId?: string
    ): Promise<unknown> {
        logger.debug(`🔧 Tool execution requested: '${toolName}'`);
        // Avoid logging raw args to prevent leaking sensitive data; hooks will emit notices if they modify payloads.

        // Allow hooks to modify/cancel before confirmation
        const beforeHookResult = await runBeforeToolCall(this.hookManager, {
            toolName,
            args,
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(callId !== undefined ? { callId } : {}),
        });

        this.logHookNotices('beforeToolCall', beforeHookResult.notices);

        if (beforeHookResult.canceled) {
            logger.debug(`🚫 Tool execution blocked by hooks: ${toolName}`);
            throw ToolError.executionDenied(
                toolName,
                sessionId,
                beforeHookResult.responseOverride ?? beforeHookResult.notices?.[0]?.message,
                beforeHookResult.notices
            );
        }

        let processedArgs = beforeHookResult.payload.args;
        if (processedArgs !== args) {
            logger.debug(`Hook modified args: ${JSON.stringify(processedArgs, null, 2)}`);
        }

        // Centralized confirmation for ALL tools
        const approved = await this.confirmationProvider.requestConfirmation({
            toolName,
            args: processedArgs,
            ...(sessionId && { sessionId }),
        });

        if (!approved) {
            logger.debug(`🚫 Tool execution denied: ${toolName}`);
            throw ToolError.executionDenied(toolName, sessionId);
        }

        logger.debug(`✅ Tool execution approved: ${toolName}`);
        logger.info(
            `🔧 Tool execution started for ${toolName}, sessionId: ${sessionId ?? 'global'}`
        );

        const startTime = Date.now();

        try {
            let result: unknown;

            // Use potentially modified arguments from hooks
            const executionArgs = processedArgs;

            // Route to MCP tools
            if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
                logger.debug(`🔧 Detected MCP tool: '${toolName}'`);
                const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
                if (actualToolName.length === 0) {
                    throw ToolError.invalidName(toolName, 'tool name cannot be empty after prefix');
                }
                logger.debug(`🎯 MCP routing: '${toolName}' -> '${actualToolName}'`);
                result = await this.mcpManager.executeTool(
                    actualToolName,
                    executionArgs,
                    sessionId
                );
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
                    executionArgs,
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

            // Run afterToolResult hooks to allow result sanitization/transformation
            const hookRes = await runAfterToolResult(this.hookManager, {
                toolName,
                result,
                success: true,
                ...(sessionId !== undefined ? { sessionId } : {}),
                ...(callId !== undefined ? { callId } : {}),
            });

            this.logHookNotices('afterToolResult:success', hookRes.notices);

            // Use modified result from hooks if any
            if (hookRes.payload.result !== result) {
                result = hookRes.payload.result;
                logger.debug(`Hook modified result`);
            }

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(
                `❌ Tool execution failed for ${toolName} after ${duration}ms, sessionId: ${sessionId ?? 'global'}: ${error instanceof Error ? error.message : String(error)}`
            );

            let thrownError: unknown = error;
            try {
                const failurePayload: AfterToolResultPayload = {
                    toolName,
                    result:
                        error instanceof Error
                            ? { error: error.message }
                            : { error: String(error) },
                    success: false,
                    ...(sessionId !== undefined ? { sessionId } : {}),
                    ...(callId !== undefined ? { callId } : {}),
                };

                const hookRes = await runAfterToolResult(this.hookManager, failurePayload);
                this.logHookNotices('afterToolResult:failure', hookRes.notices);

                if (hookRes.responseOverride) {
                    thrownError = ToolError.executionFailed(
                        toolName,
                        hookRes.responseOverride,
                        sessionId,
                        hookRes.notices
                    );
                }

                if (hookRes.payload.result !== failurePayload.result) {
                    logger.debug(`Hook modified failure result payload`);
                    if (
                        thrownError === error &&
                        hookRes.payload.result &&
                        typeof hookRes.payload.result === 'object' &&
                        'error' in hookRes.payload.result
                    ) {
                        const sanitizedMessage = (hookRes.payload.result as any).error;
                        if (typeof sanitizedMessage === 'string' && sanitizedMessage.length > 0) {
                            thrownError = ToolError.executionFailed(
                                toolName,
                                sanitizedMessage,
                                sessionId,
                                hookRes.notices
                            );
                        }
                    }
                }
            } catch (hookError) {
                const errorMessage =
                    hookError instanceof Error
                        ? `${hookError.message}${hookError.stack ? `\n${hookError.stack}` : ''}`
                        : String(hookError);
                logger.error(`Hook error during failure handling: ${errorMessage}`);
            }

            throw thrownError;
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
     * Refresh tool discovery (call when MCP servers change)
     */
    async refresh(): Promise<void> {
        // Invalidate cache since MCP servers may have changed
        this.invalidateCache();

        logger.debug('ToolManager refreshed');
    }
}
