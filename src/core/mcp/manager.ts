import { MCPClient } from './mcp-client.js';
import { ValidatedServerConfigs, ValidatedMcpServerConfig } from './schemas.js';
import { logger } from '../logger/index.js';
import { IMCPClient } from './types.js';
import { ToolSet } from '../tools/types.js';
import { ToolConfirmationProvider } from '../tools/confirmation/types.js';
import { NoOpConfirmationProvider } from '../tools/confirmation/noop-confirmation-provider.js';
import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPError } from './errors.js';

/**
 * Centralized manager for Multiple Model Context Protocol (MCP) servers.
 *
 * The MCPManager serves as a focused interface for managing connections to MCP servers
 * and providing access to their capabilities (tools, prompts, resources).
 *
 * Key responsibilities:
 * - **Client Management**: Register, connect, disconnect, and remove MCP clients
 * - **Resource Discovery**: Cache and provide access to tools, prompts, and resources from connected clients
 * - **MCP Tool Execution**: Execute MCP tools with built-in confirmation mechanisms
 * - **Connection Handling**: Support both strict and lenient connection modes with error tracking
 * - **Caching**: Maintain efficient lookup maps for fast access to client capabilities
 *
 * The manager supports dynamic client connections, allowing servers to be added or removed at runtime.
 * It includes robust error handling and maintains connection state for debugging purposes.
 *
 * Note: This class focuses only on MCP server management. For unified tool management
 * across multiple sources (MCP + custom tools), use the ToolManager class.
 *
 * @example
 * ```typescript
 * const manager = new MCPManager();
 * await manager.initializeFromConfig(serverConfigs);
 *
 * // Execute an MCP tool
 * const result = await manager.executeTool('my_tool', { param: 'value' });
 *
 * // Get all available MCP tools
 * const tools = await manager.getAllTools();
 * ```
 */
export class MCPManager {
    private clients: Map<string, IMCPClient> = new Map();
    private connectionErrors: { [key: string]: string } = {};
    private toolToClientMap: Map<string, IMCPClient> = new Map();
    private serverToolsMap: Map<string, Map<string, IMCPClient>> = new Map();
    private toolConflicts: Set<string> = new Set();
    private promptToClientMap: Map<string, IMCPClient> = new Map();
    private resourceToClientMap: Map<string, IMCPClient> = new Map();
    private confirmationProvider: ToolConfirmationProvider;
    private sanitizedNameToServerMap: Map<string, string> = new Map();

    // Use a distinctive delimiter that won't appear in normal server/tool names
    // Using double hyphen as it's allowed in LLM tool name patterns (^[a-zA-Z0-9_-]+$)
    private static readonly SERVER_DELIMITER = '--';

    constructor(confirmationProvider?: ToolConfirmationProvider) {
        // If a confirmation provider is passed, use it, otherwise use auto-approve fallback
        this.confirmationProvider = confirmationProvider ?? new NoOpConfirmationProvider();
    }

    /**
     * Register a client that provides tools (and potentially more)
     * @param name Unique name for the client
     * @param client The client instance, expected to be IMCPClient
     */
    registerClient(name: string, client: IMCPClient): void {
        if (this.clients.has(name)) {
            logger.warn(`Client '${name}' already registered. Overwriting.`);
        }

        // Clear cache first (which removes old mappings)
        this.clearClientCache(name);

        // Validate sanitized name uniqueness to prevent collisions
        const sanitizedName = this.sanitizeServerName(name);
        const existingServerWithSameSanitizedName =
            this.sanitizedNameToServerMap.get(sanitizedName);
        if (existingServerWithSameSanitizedName && existingServerWithSameSanitizedName !== name) {
            throw MCPError.duplicateName(name, existingServerWithSameSanitizedName);
        }

        this.clients.set(name, client);
        this.sanitizedNameToServerMap.set(sanitizedName, name);

        logger.info(`Registered client: ${name}`);
        delete this.connectionErrors[name];
    }

    private clearClientCache(clientName: string): void {
        const client = this.clients.get(clientName);
        if (!client) return;

        // Remove from server tools map
        const hadServerTools = this.serverToolsMap.has(clientName);
        this.serverToolsMap.delete(clientName);

        // Remove from sanitized name mapping
        const sanitizedName = this.sanitizeServerName(clientName);
        if (this.sanitizedNameToServerMap.get(sanitizedName) === clientName) {
            this.sanitizedNameToServerMap.delete(sanitizedName);
        }

        [this.toolToClientMap, this.promptToClientMap, this.resourceToClientMap].forEach(
            (cacheMap) => {
                for (const [key, mappedClient] of Array.from(cacheMap.entries())) {
                    if (mappedClient === client) {
                        cacheMap.delete(key);
                    }
                }
            }
        );

        // Only rebuild conflicts if this client actually had tools
        if (hadServerTools) {
            this.rebuildToolConflicts();
        }
        logger.debug(`Cleared cache for client: ${clientName}`);
    }

    private rebuildToolConflicts(): void {
        this.toolConflicts.clear();
        const toolCounts = new Map<string, number>();

        // Count tool occurrences across all servers
        for (const serverTools of this.serverToolsMap.values()) {
            for (const toolName of serverTools.keys()) {
                toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
            }
        }

        // Remove conflicted tools from main map first
        for (const [toolName, count] of toolCounts.entries()) {
            if (count > 1) {
                this.toolConflicts.add(toolName);
                this.toolToClientMap.delete(toolName);
            }
        }

        // Re-add non-conflicted tools to main map
        for (const [_, serverTools] of this.serverToolsMap.entries()) {
            for (const [toolName, client] of serverTools.entries()) {
                if (!this.toolConflicts.has(toolName)) {
                    this.toolToClientMap.set(toolName, client);
                }
            }
        }
    }

    /**
     * Sanitize server name for use in tool prefixing.
     * Ensures the name is safe for LLM provider tool naming constraints.
     */
    private sanitizeServerName(serverName: string): string {
        return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private async updateClientCache(clientName: string, client: IMCPClient): Promise<void> {
        // Initialize server tools map
        const serverTools = new Map<string, IMCPClient>();
        this.serverToolsMap.set(clientName, serverTools);

        // Cache tools
        try {
            const tools = await client.getTools();
            logger.debug(
                `🔧 Discovered ${Object.keys(tools).length} tools from server '${clientName}': [${Object.keys(tools).join(', ')}]`
            );

            for (const toolName in tools) {
                // Store in server-specific map
                serverTools.set(toolName, client);

                // Add to main map if no conflict, otherwise mark as conflicted
                const existingClient = this.toolToClientMap.get(toolName);
                if (existingClient && existingClient !== client) {
                    // Conflict detected
                    this.toolConflicts.add(toolName);
                    this.toolToClientMap.delete(toolName);
                    logger.warn(
                        `⚠️  Tool conflict detected for '${toolName}' - will use server prefix`
                    );
                } else if (!this.toolConflicts.has(toolName)) {
                    this.toolToClientMap.set(toolName, client);
                    logger.debug(`✅ Tool '${toolName}' mapped to ${clientName}`);
                }
            }
            logger.debug(
                `✅ Successfully cached ${Object.keys(tools).length} tools for client: ${clientName}`
            );
        } catch (error) {
            logger.error(
                `❌ Error retrieving tools for client ${clientName}: ${error instanceof Error ? error.message : String(error)}`
            );
            return; // Early return on error, no caching
        }

        // Cache prompts, if supported
        try {
            const prompts = await client.listPrompts();
            prompts.forEach((promptName) => {
                this.promptToClientMap.set(promptName, client);
            });
            logger.debug(`Cached prompts for client: ${clientName}`);
        } catch (error) {
            logger.debug(`Skipping prompts for client ${clientName}: ${error}`);
        }

        // Cache resources, if supported
        // TODO: HF SERVER HAS 100000+ RESOURCES - need to think of a way to make resources/caching optional or better.
        try {
            const resources = await client.listResources();
            resources.forEach((resourceUri) => {
                this.resourceToClientMap.set(resourceUri, client);
            });
            logger.debug(`Cached resources for client: ${clientName}`);
        } catch (error) {
            logger.debug(`Skipping resources for client ${clientName}: ${error}`);
        }
    }

    /**
     * Get all available MCP tools from all connected clients, updating the cache.
     * Conflicted tools are prefixed with server name using distinctive delimiter.
     * @returns Promise resolving to a ToolSet mapping tool names to Tool definitions
     */
    async getAllTools(): Promise<ToolSet> {
        const allTools: ToolSet = {};
        const clientToolsCache = new Map<IMCPClient, ToolSet>();

        // Helper function to get tools for a client (with caching)
        const getClientTools = async (client: IMCPClient): Promise<ToolSet> => {
            if (!clientToolsCache.has(client)) {
                const tools = await client.getTools();
                clientToolsCache.set(client, tools);
            }
            return clientToolsCache.get(client)!;
        };

        // Add non-conflicted MCP tools directly
        for (const [toolName, client] of Array.from(this.toolToClientMap.entries())) {
            const clientTools = await getClientTools(client);
            const toolDef = clientTools[toolName];
            if (toolDef) {
                allTools[toolName] = toolDef;
            }
        }

        // Add conflicted tools with server prefix using distinctive delimiter
        for (const [serverName, serverTools] of this.serverToolsMap.entries()) {
            for (const [toolName, client] of serverTools.entries()) {
                if (this.toolConflicts.has(toolName)) {
                    const sanitizedServerName = this.sanitizeServerName(serverName);
                    const qualifiedName = `${sanitizedServerName}${MCPManager.SERVER_DELIMITER}${toolName}`;

                    const clientTools = await getClientTools(client);
                    const toolDef = clientTools[toolName];
                    if (toolDef) {
                        allTools[qualifiedName] = {
                            ...toolDef,
                            description: toolDef.description
                                ? `${toolDef.description} (via ${serverName})`
                                : `Tool from ${serverName}`,
                        };
                    }
                }
            }
        }

        logger.debug(
            `🔧 MCP tool discovery: ${Object.keys(allTools).length} total tools, ${this.toolConflicts.size} conflicts, connected servers: ${Array.from(this.serverToolsMap.keys()).join(', ')}`
        );

        if (logger.getLevel() === 'debug') {
            Object.keys(allTools).forEach((toolName) => {
                if (toolName.includes(MCPManager.SERVER_DELIMITER)) {
                    logger.debug(`  - ${toolName} (qualified)`);
                } else {
                    logger.debug(`  - ${toolName}`);
                }
            });
        }

        logger.silly(`MCP tools: ${JSON.stringify(allTools, null, 2)}`);
        return allTools;
    }

    /**
     * Parse a qualified tool name to extract server name and actual tool name.
     * Uses distinctive delimiter to avoid ambiguity and splits on last occurrence.
     */
    private parseQualifiedToolName(
        toolName: string
    ): { serverName: string; toolName: string } | null {
        const delimiterIndex = toolName.lastIndexOf(MCPManager.SERVER_DELIMITER);
        if (delimiterIndex === -1) {
            return null; // Not a qualified tool name
        }

        const serverPrefix = toolName.substring(0, delimiterIndex);
        const actualToolName = toolName.substring(
            delimiterIndex + MCPManager.SERVER_DELIMITER.length
        );

        // O(1) lookup using pre-computed sanitized name map
        const originalServerName = this.sanitizedNameToServerMap.get(serverPrefix);
        if (
            originalServerName &&
            this.serverToolsMap.get(originalServerName)?.has(actualToolName)
        ) {
            return { serverName: originalServerName, toolName: actualToolName };
        }

        return null;
    }

    /**
     * Get client that provides a specific tool from the cache.
     * Handles both simple tool names and server-prefixed tool names.
     * @param toolName Name of the tool (may include server prefix)
     * @returns The client that provides the tool, or undefined if not found
     */
    getToolClient(toolName: string): IMCPClient | undefined {
        // First try to parse as qualified tool name
        const parsed = this.parseQualifiedToolName(toolName);
        if (parsed) {
            const serverTools = this.serverToolsMap.get(parsed.serverName);
            return serverTools?.get(parsed.toolName);
        }

        // Otherwise try as simple tool name
        return this.toolToClientMap.get(toolName);
    }

    /**
     * Execute a specific MCP tool with the given arguments.
     * @param toolName Name of the MCP tool to execute (may include server prefix)
     * @param args Arguments to pass to the tool
     * @param sessionId Optional session ID
     * @returns Promise resolving to the tool execution result
     */
    async executeTool(toolName: string, args: any, _sessionId?: string): Promise<any> {
        const client = this.getToolClient(toolName);
        if (!client) {
            logger.error(`❌ No MCP tool found: ${toolName}`);
            logger.debug(
                `Available MCP tools: ${Array.from(this.toolToClientMap.keys()).join(', ')}`
            );
            logger.debug(`Conflicted tools: ${Array.from(this.toolConflicts).join(', ')}`);
            logger.debug(
                `Server tools map keys: ${Array.from(this.serverToolsMap.keys()).join(', ')}`
            );
            throw MCPError.toolNotFound(toolName);
        }

        // Extract actual tool name (remove server prefix if present)
        const parsed = this.parseQualifiedToolName(toolName);
        const actualToolName = parsed ? parsed.toolName : toolName;
        const serverName = parsed ? parsed.serverName : 'direct';

        logger.debug(`▶️  Executing MCP tool '${actualToolName}' on server '${serverName}'...`);

        try {
            const result = await client.callTool(actualToolName, args);
            return result;
        } catch (error) {
            logger.error(
                `❌ MCP tool execution failed: '${actualToolName}' - ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get all available prompt names from all connected clients, updating the cache.
     * @returns Promise resolving to an array of unique prompt names.
     */
    async listAllPrompts(): Promise<string[]> {
        return Array.from(this.promptToClientMap.keys());
    }

    /**
     * Get the client that provides a specific prompt from the cache.
     * @param promptName Name of the prompt.
     * @returns The client instance or undefined.
     */
    getPromptClient(promptName: string): IMCPClient | undefined {
        return this.promptToClientMap.get(promptName);
    }

    /**
     * Get a specific prompt definition by name.
     * @param name Name of the prompt.
     * @param args Arguments for the prompt (optional).
     * @returns Promise resolving to the prompt definition.
     */
    async getPrompt(name: string, args?: any): Promise<GetPromptResult> {
        const client = this.getPromptClient(name);
        if (!client) {
            throw MCPError.promptNotFound(name);
        }
        return await client.getPrompt(name, args);
    }

    /**
     * Get all available resource URIs from all connected clients, updating the cache.
     * @returns Promise resolving to an array of unique resource URIs.
     */
    async listAllResources(): Promise<string[]> {
        return Array.from(this.resourceToClientMap.keys());
    }

    /**
     * Get the client that provides a specific resource from the cache.
     * @param resourceUri URI of the resource.
     * @returns The client instance or undefined.
     */
    getResourceClient(resourceUri: string): IMCPClient | undefined {
        return this.resourceToClientMap.get(resourceUri);
    }

    /**
     * Read a specific resource by URI.
     * @param uri URI of the resource.
     * @returns Promise resolving to the resource content.
     */
    async readResource(uri: string): Promise<ReadResourceResult> {
        const client = this.getResourceClient(uri);
        if (!client) {
            throw MCPError.resourceNotFound(uri);
        }
        return await client.readResource(uri);
    }

    /**
     * Initialize clients from server configurations
     * @param serverConfigs Server configurations with individual connection modes
     * @returns Promise resolving when initialization is complete
     */
    async initializeFromConfig(serverConfigs: ValidatedServerConfigs): Promise<void> {
        // Handle empty server configurations gracefully
        if (Object.keys(serverConfigs).length === 0) {
            logger.info('No MCP servers configured - running without external tools');
            return;
        }

        const successfulConnections: string[] = [];
        const connectionPromises: Promise<void>[] = [];
        const strictServers: string[] = [];
        const lenientServers: string[] = [];

        // Categorize servers by their connection mode
        for (const [name, config] of Object.entries(serverConfigs)) {
            const effectiveMode = config.connectionMode || 'lenient';
            if (effectiveMode === 'strict') {
                strictServers.push(name);
            } else {
                lenientServers.push(name);
            }

            const connectPromise = this.connectServer(name, config)
                .then(() => {
                    successfulConnections.push(name);
                })
                .catch((error) => {
                    logger.debug(
                        `Handled connection error for '${name}' during initialization: ${error.message}`
                    );
                });
            connectionPromises.push(connectPromise);
        }

        await Promise.all(connectionPromises);

        // Check strict servers - all must succeed
        const failedStrictServers = strictServers.filter(
            (name) => !successfulConnections.includes(name)
        );
        if (failedStrictServers.length > 0) {
            const strictErrors = failedStrictServers
                .map((name) => `${name}: ${this.connectionErrors[name] || 'Unknown error'}`)
                .join('; ');
            throw MCPError.connectionFailed('strict servers', strictErrors);
        }

        // Lenient servers are allowed to fail without throwing errors
        // No additional validation needed for lenient servers
    }

    /**
     * Dynamically connect to a new MCP server.
     * @param name The unique name for the new server connection.
     * @param config The configuration for the server.
     * @returns Promise resolving when the connection attempt is complete.
     * @throws Error if the connection fails.
     */
    async connectServer(name: string, config: ValidatedMcpServerConfig): Promise<void> {
        if (this.clients.has(name)) {
            logger.warn(`Client '${name}' is already connected or registered.`);
            return;
        }

        const client = new MCPClient();
        try {
            logger.info(`Attempting to connect to new server '${name}'...`);
            await client.connect(config, name);
            this.registerClient(name, client);
            await this.updateClientCache(name, client);
            logger.info(`Successfully connected and cached new server '${name}'`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.connectionErrors[name] = errorMsg;
            logger.error(`Failed to connect to new server '${name}': ${errorMsg}`);
            this.clients.delete(name);
            throw MCPError.connectionFailed(name, errorMsg);
        }
    }

    /**
     * Get all registered clients
     * @returns Map of client names to client instances
     */
    getClients(): Map<string, IMCPClient> {
        return this.clients;
    }

    /**
     * Get the errors from failed connections
     * @returns Map of server names to error messages
     */
    getFailedConnections(): { [key: string]: string } {
        return this.connectionErrors;
    }

    /**
     * Disconnect and remove a specific client by name.
     * @param name The name of the client to remove.
     */
    async removeClient(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (client) {
            if (typeof client.disconnect === 'function') {
                try {
                    await client.disconnect();
                    logger.info(`Successfully disconnected client: ${name}`);
                } catch (error) {
                    logger.error(
                        `Error disconnecting client '${name}': ${error instanceof Error ? error.message : String(error)}`
                    );
                    // Continue with removal even if disconnection fails
                }
            }
            // Clear cache BEFORE removing from clients map
            this.clearClientCache(name);
            this.clients.delete(name);
            logger.info(`Removed client from manager: ${name}`);
        }
        // Also remove from failed connections if it was registered there before successful connection or if it failed.
        if (this.connectionErrors[name]) {
            delete this.connectionErrors[name];
            logger.info(`Cleared connection error for removed client: ${name}`);
        }
    }

    /**
     * Disconnect all clients and clear caches
     */
    async disconnectAll(): Promise<void> {
        const disconnectPromises: Promise<void>[] = [];
        for (const [name, client] of Array.from(this.clients.entries())) {
            if (client.disconnect) {
                disconnectPromises.push(
                    client
                        .disconnect()
                        .then(() => logger.info(`Disconnected client: ${name}`))
                        .catch((error) =>
                            logger.error(`Failed to disconnect client '${name}': ${error}`)
                        )
                );
            }
        }
        await Promise.all(disconnectPromises);

        this.clients.clear();
        this.connectionErrors = {};
        this.toolToClientMap.clear();
        this.serverToolsMap.clear();
        this.toolConflicts.clear();
        this.promptToClientMap.clear();
        this.resourceToClientMap.clear();
        this.sanitizedNameToServerMap.clear();
        logger.info('Disconnected all clients and cleared caches.');
    }
}
