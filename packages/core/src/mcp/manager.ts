import { MCPClient } from './mcp-client.js';
import { ValidatedServersConfig, ValidatedMcpServerConfig } from './schemas.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { GetPromptResult, ReadResourceResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import {
    IMCPClient,
    MCPResolvedResource,
    MCPResourceSummary,
    McpAuthProviderFactory,
} from './types.js';
import { ToolSet } from '../tools/types.js';
import { MCPError } from './errors.js';
import { eventBus } from '../events/index.js';
import type { PromptDefinition } from '../prompts/types.js';
import type { JSONSchema7 } from 'json-schema';
import type { ApprovalManager } from '../approval/manager.js';

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
type ResourceCacheEntry = {
    serverName: string;
    client: IMCPClient;
    summary: MCPResourceSummary;
};

type PromptCacheEntry = {
    serverName: string;
    client: IMCPClient;
    definition: PromptDefinition;
};

type ToolCacheEntry = {
    serverName: string;
    client: IMCPClient;
    definition: {
        name?: string;
        description?: string;
        parameters: JSONSchema7;
    };
};

export class MCPManager {
    private clients: Map<string, IMCPClient> = new Map();
    private connectionErrors: { [key: string]: { message: string; code?: string } } = {};
    private configCache: Map<string, ValidatedMcpServerConfig> = new Map(); // Store original configs for restart
    private toolCache: Map<string, ToolCacheEntry> = new Map();
    private toolConflicts: Set<string> = new Set(); // Track which tool names have conflicts
    private promptCache: Map<string, PromptCacheEntry> = new Map();
    private resourceCache: Map<string, ResourceCacheEntry> = new Map();
    private sanitizedNameToServerMap: Map<string, string> = new Map();
    private approvalManager: ApprovalManager | null = null; // Will be set by service initializer
    private authProviderFactory: McpAuthProviderFactory | null = null;
    private logger: Logger;

    // Use a distinctive delimiter that won't appear in normal server/tool names
    // Using double hyphen as it's allowed in LLM tool name patterns (^[a-zA-Z0-9_-]+$)
    private static readonly SERVER_DELIMITER = '--';

    constructor(logger: Logger) {
        this.logger = logger.createChild(DextoLogComponent.MCP);
    }

    setAuthProviderFactory(factory: McpAuthProviderFactory | null): void {
        this.authProviderFactory = factory;
        for (const [_name, client] of this.clients.entries()) {
            if (client instanceof MCPClient) {
                client.setAuthProviderFactory(factory);
            }
        }
    }

    /**
     * Set the approval manager for handling elicitation requests from MCP servers
     *
     * TODO: Consider making ApprovalManager a required constructor parameter instead of using a setter.
     * This would make the dependency explicit and remove the need for defensive `if (!approvalManager)` checks.
     * Current setter pattern is useful if we want to expose MCPManager as a standalone service to end-users
     * without requiring them to know about ApprovalManager.
     */
    setApprovalManager(approvalManager: ApprovalManager): void {
        this.approvalManager = approvalManager;
        // Update all existing clients with the approval manager
        for (const [_name, client] of this.clients.entries()) {
            if (client instanceof MCPClient) {
                client.setApprovalManager(approvalManager);
            }
        }
    }

    private buildQualifiedResourceKey(serverName: string, resourceUri: string): string {
        return `mcp:${serverName}:${resourceUri}`;
    }

    private parseQualifiedResourceKey(key: string): { serverName: string; resourceUri: string } {
        if (!key.startsWith('mcp:')) {
            throw MCPError.resourceNotFound(key);
        }
        const [, serverName, ...rest] = key.split(':');
        if (!serverName || rest.length === 0) {
            throw MCPError.resourceNotFound(key);
        }
        return { serverName, resourceUri: rest.join(':') };
    }

    private removeServerResources(serverName: string): void {
        for (const [key, entry] of Array.from(this.resourceCache.entries())) {
            if (entry.serverName === serverName) {
                this.resourceCache.delete(key);
            }
        }
    }

    private getResourceCacheEntry(resourceKey: string): ResourceCacheEntry | undefined {
        if (this.resourceCache.has(resourceKey)) {
            return this.resourceCache.get(resourceKey);
        }

        try {
            const { serverName, resourceUri } = this.parseQualifiedResourceKey(resourceKey);
            const canonicalKey = this.buildQualifiedResourceKey(serverName, resourceUri);
            return this.resourceCache.get(canonicalKey);
        } catch {
            return undefined;
        }
    }

    /**
     * Register a client that provides tools (and potentially more)
     * @param name Unique name for the client
     * @param client The client instance, expected to be IMCPClient
     */
    registerClient(name: string, client: IMCPClient): void {
        if (this.clients.has(name)) {
            this.logger.warn(`Client '${name}' already registered. Overwriting.`);
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
        this.setupClientNotifications(name, client);

        this.logger.info(`Registered client: ${name}`);
        delete this.connectionErrors[name];
    }

    /**
     * Clears all cached data for a disconnected MCP client
     *
     * Performs comprehensive cleanup of tool, prompt, and resource caches.
     * Uses two-pass algorithm to detect and resolve tool name conflicts:
     * if a conflicted tool now has only one provider, restores simple name.
     *
     * @param clientName - The name/identifier of the MCP server being removed
     * @private
     */
    private clearClientCache(clientName: string): void {
        const client = this.clients.get(clientName);
        if (!client) return;

        // Remove from sanitized name mapping
        const sanitizedName = this.sanitizeServerName(clientName);
        if (this.sanitizedNameToServerMap.get(sanitizedName) === clientName) {
            this.sanitizedNameToServerMap.delete(sanitizedName);
        }

        // Clear tool cache for this server and restore simple names when conflicts resolve
        const removedToolBaseNames = new Set<string>();

        // First pass: collect base names and remove all tools from this server
        for (const [toolKey, entry] of Array.from(this.toolCache.entries())) {
            if (entry.serverName === clientName) {
                // Extract base name from qualified key (handle both simple and qualified names)
                const delimiterIndex = toolKey.lastIndexOf(MCPManager.SERVER_DELIMITER);
                const baseName =
                    delimiterIndex === -1
                        ? toolKey
                        : toolKey.substring(delimiterIndex + MCPManager.SERVER_DELIMITER.length);

                removedToolBaseNames.add(baseName);
                this.toolCache.delete(toolKey);
            }
        }

        // Second pass: check for resolved conflicts and restore simple names
        for (const baseName of removedToolBaseNames) {
            // Find all remaining tools with this base name
            const remainingTools = Array.from(this.toolCache.entries()).filter(([key, _]) => {
                const delimiterIndex = key.lastIndexOf(MCPManager.SERVER_DELIMITER);
                const bn =
                    delimiterIndex === -1
                        ? key
                        : key.substring(delimiterIndex + MCPManager.SERVER_DELIMITER.length);
                return bn === baseName;
            });

            if (remainingTools.length === 0) {
                // No tools with this name remain
                this.toolConflicts.delete(baseName);
            } else if (remainingTools.length === 1 && this.toolConflicts.has(baseName)) {
                // Exactly one tool remains - restore to simple name
                const singleTool = remainingTools[0];
                if (singleTool) {
                    const [qualifiedKey, entry] = singleTool;
                    this.toolCache.delete(qualifiedKey);
                    this.toolCache.set(baseName, entry);
                    this.toolConflicts.delete(baseName);
                    this.logger.debug(
                        `Restored tool '${baseName}' to simple name (conflict resolved)`
                    );
                }
            }
            // If remainingTools.length > 1, conflict still exists, keep qualified names
        }

        // Clear prompt metadata cache for this server
        for (const [promptName, entry] of Array.from(this.promptCache.entries())) {
            if (entry.serverName === clientName) {
                this.promptCache.delete(promptName);
            }
        }

        // Clear resource cache for this server
        for (const [key, entry] of Array.from(this.resourceCache.entries())) {
            if (entry.client === client || entry.serverName === clientName) {
                this.resourceCache.delete(key);
            }
        }

        this.logger.debug(`Cleared cache for client: ${clientName}`);
    }

    /**
     * Sanitize server name for use in tool prefixing.
     * Ensures the name is safe for LLM provider tool naming constraints.
     */
    private sanitizeServerName(serverName: string): string {
        return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /**
     * Updates internal caches for a connected MCP client
     *
     * This method performs initial cache population after a client connects.
     * It fetches and caches tools, prompts, and resources from the MCP server,
     * implementing conflict detection and resolution for tool names.
     *
     * @param clientName - The name/identifier of the MCP server
     * @param client - The connected MCP client instance
     *
     * @remarks
     * **Tool Caching:**
     * - Fetches all tools and caches them with full definitions
     * - Detects naming conflicts when multiple servers provide same tool name
     * - On conflict: uses qualified names (`server--toolname`) for all conflicting tools
     * - Updates toolConflicts set to track which base names have conflicts
     *
     * **Prompt Caching:**
     * - Fetches all prompts and their metadata (description, arguments)
     * - Stores full prompt definitions in promptCache for efficient access
     * - Falls back to minimal metadata if full definition fetch fails
     *
     * **Resource Caching:**
     * - Fetches all resource summaries (uri, name, mimeType)
     * - Stores resource metadata in resourceCache for quick lookups
     *
     * **Error Handling:**
     * - Tool fetch errors abort caching entirely (early return)
     * - Prompt/resource errors log warnings but don't block other caching
     * - Individual prompt metadata errors are caught and logged
     *
     * @private
     */
    private async updateClientCache(clientName: string, client: IMCPClient): Promise<void> {
        // Cache tools with full definitions
        try {
            const tools = await client.getTools();
            this.logger.debug(
                `🔧 Discovered ${Object.keys(tools).length} tools from server '${clientName}': [${Object.keys(tools).join(', ')}]`
            );

            for (const toolName in tools) {
                const toolDef = tools[toolName];
                if (!toolDef) continue; // Skip undefined tool definitions

                // Check if this tool name already exists from a different server
                const existingEntry = this.toolCache.get(toolName);
                if (existingEntry && existingEntry.serverName !== clientName) {
                    // Conflict detected! Move existing to qualified name
                    this.toolConflicts.add(toolName);
                    this.toolCache.delete(toolName);

                    const existingSanitized = this.sanitizeServerName(existingEntry.serverName);
                    const existingQualified = `${existingSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(existingQualified, existingEntry);

                    // Add new tool with qualified name
                    const newSanitized = this.sanitizeServerName(clientName);
                    const newQualified = `${newSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(newQualified, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });

                    this.logger.warn(
                        `⚠️  Tool conflict detected for '${toolName}' - using server prefixes: ${existingQualified}, ${newQualified}`
                    );
                } else if (this.toolConflicts.has(toolName)) {
                    // This tool name is already known to be conflicted
                    const sanitizedName = this.sanitizeServerName(clientName);
                    const qualifiedName = `${sanitizedName}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(qualifiedName, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });
                    this.logger.debug(`✅ Tool '${qualifiedName}' cached (known conflict)`);
                } else {
                    // No conflict, cache with simple name
                    this.toolCache.set(toolName, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });
                    this.logger.debug(`✅ Tool '${toolName}' mapped to ${clientName}`);
                }
            }
            this.logger.debug(
                `✅ Successfully cached ${Object.keys(tools).length} tools for client: ${clientName}`
            );
        } catch (error) {
            this.logger.error(
                `❌ Error retrieving tools for client ${clientName}: ${error instanceof Error ? error.message : String(error)}`
            );
            return; // Early return on error, no caching
        }

        // Cache prompts with metadata from listPrompts() (no additional network calls needed)
        try {
            const prompts: Prompt[] = await client.listPrompts();

            for (const prompt of prompts) {
                // Convert MCP SDK Prompt to our PromptDefinition
                const definition: PromptDefinition = {
                    name: prompt.name,
                    ...(prompt.title && { title: prompt.title }),
                    ...(prompt.description && { description: prompt.description }),
                    ...(prompt.arguments && { arguments: prompt.arguments }),
                };

                this.promptCache.set(prompt.name, {
                    serverName: clientName,
                    client,
                    definition,
                });
            }

            this.logger.debug(`Cached ${prompts.length} prompts for client: ${clientName}`);
        } catch (error) {
            this.logger.debug(`Skipping prompts for client ${clientName}: ${error}`);
        }

        // Cache resources, if supported
        // TODO: HF SERVER HAS 100000+ RESOURCES - need to think of a way to make resources/caching optional or better.
        try {
            this.removeServerResources(clientName);
            const resources = await client.listResources();
            resources.forEach((summary) => {
                const key = this.buildQualifiedResourceKey(clientName, summary.uri);
                this.resourceCache.set(key, {
                    serverName: clientName,
                    client,
                    summary,
                });
            });
            this.logger.debug(`Cached resources for client: ${clientName}`);
        } catch (error) {
            this.logger.debug(`Skipping resources for client ${clientName}: ${error}`);
        }
    }

    /**
     * Get all available MCP tools from cache (no network calls).
     * Conflicted tools are already stored with qualified names.
     * @returns Promise resolving to a ToolSet mapping tool names to Tool definitions
     */
    async getAllTools(): Promise<ToolSet> {
        const allTools: ToolSet = {};

        // Build tool set from cache
        for (const [toolKey, entry] of this.toolCache.entries()) {
            const toolDef = entry.definition;

            // For qualified names (conflicts), enhance description with server name
            if (toolKey.includes(MCPManager.SERVER_DELIMITER)) {
                allTools[toolKey] = {
                    ...toolDef,
                    description: toolDef.description
                        ? `${toolDef.description} (via ${entry.serverName})`
                        : `Tool from ${entry.serverName}`,
                };
            } else {
                // Simple name, use as-is
                allTools[toolKey] = toolDef;
            }
        }

        const serverNames = Array.from(
            new Set(Array.from(this.toolCache.values()).map((e) => e.serverName))
        );

        this.logger.debug(
            `🔧 MCP tools from cache: ${Object.keys(allTools).length} total tools, ${this.toolConflicts.size} conflicts, connected servers: ${serverNames.join(', ')}`
        );

        Object.keys(allTools).forEach((toolName) => {
            if (toolName.includes(MCPManager.SERVER_DELIMITER)) {
                this.logger.debug(`  - ${toolName} (qualified)`);
            } else {
                this.logger.debug(`  - ${toolName}`);
            }
        });

        this.logger.silly(`MCP tools: ${JSON.stringify(allTools, null, 2)}`);
        return allTools;
    }

    /**
     * Get all MCP tools with their server metadata.
     * This returns the internal tool cache entries which include server names.
     * @returns Map of tool names to their cache entries (includes serverName, client, and definition)
     */
    getAllToolsWithServerInfo(): Map<string, ToolCacheEntry> {
        return new Map(this.toolCache);
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

        // Verify this qualified name exists in cache
        if (originalServerName && this.toolCache.has(toolName)) {
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
        // Try to get directly from cache (handles both simple and qualified names)
        return this.toolCache.get(toolName)?.client;
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
            this.logger.error(`❌ No MCP tool found: ${toolName}`);
            this.logger.debug(
                `Available MCP tools: ${Array.from(this.toolCache.keys()).join(', ')}`
            );
            this.logger.debug(`Conflicted tools: ${Array.from(this.toolConflicts).join(', ')}`);
            throw MCPError.toolNotFound(toolName);
        }

        // Extract actual tool name (remove server prefix if present)
        const parsed = this.parseQualifiedToolName(toolName);
        const actualToolName = parsed ? parsed.toolName : toolName;
        const serverName = parsed ? parsed.serverName : 'direct';

        this.logger.debug(
            `▶️  Executing MCP tool '${actualToolName}' on server '${serverName}'...`
        );

        try {
            const result = await client.callTool(actualToolName, args);
            return result;
        } catch (error) {
            this.logger.error(
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
        return Array.from(this.promptCache.keys());
    }

    /**
     * Get the client that provides a specific prompt from the cache.
     * @param promptName Name of the prompt.
     * @returns The client instance or undefined.
     */
    getPromptClient(promptName: string): IMCPClient | undefined {
        return this.promptCache.get(promptName)?.client;
    }

    /**
     * Get a specific prompt definition by name.
     * @param name Name of the prompt.
     * @param args Arguments for the prompt (optional).
     * @returns Promise resolving to the prompt definition.
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const client = this.getPromptClient(name);
        if (!client) {
            throw MCPError.promptNotFound(name);
        }
        return await client.getPrompt(name, args);
    }

    /**
     * Get cached prompt metadata (no network calls).
     * @param promptName Name of the prompt.
     * @returns Cached prompt definition or undefined if not cached.
     */
    getPromptMetadata(promptName: string): PromptDefinition | undefined {
        const entry = this.promptCache.get(promptName);
        return entry?.definition;
    }

    /**
     * Get all cached prompt metadata (no network calls).
     * @returns Array of all cached prompt definitions with server info.
     */
    getAllPromptMetadata(): Array<{
        promptName: string;
        serverName: string;
        definition: PromptDefinition;
    }> {
        return Array.from(this.promptCache.entries()).map(([promptName, entry]) => ({
            promptName,
            serverName: entry.serverName,
            definition: entry.definition,
        }));
    }

    /**
     * Get all cached MCP resources (no network calls).
     */
    async listAllResources(): Promise<MCPResolvedResource[]> {
        return Array.from(this.resourceCache.entries()).map(([key, { serverName, summary }]) => ({
            key,
            serverName,
            summary,
        }));
    }

    /**
     * Determine if a qualified MCP resource is cached.
     */
    hasResource(resourceKey: string): boolean {
        return this.getResourceCacheEntry(resourceKey) !== undefined;
    }

    /**
     * Get cached resource metadata by qualified key.
     */
    getResource(resourceKey: string): MCPResolvedResource | undefined {
        const entry = this.getResourceCacheEntry(resourceKey);
        if (!entry) return undefined;
        return {
            key: resourceKey,
            serverName: entry.serverName,
            summary: entry.summary,
        };
    }

    /**
     * Read a specific resource by qualified URI.
     * @param resourceKey Qualified resource key in the form mcp:server:uri.
     * @returns Promise resolving to the resource content.
     */
    async readResource(resourceKey: string): Promise<ReadResourceResult> {
        const entry = this.getResourceCacheEntry(resourceKey);
        if (!entry) {
            throw MCPError.resourceNotFound(resourceKey);
        }
        return await entry.client.readResource(entry.summary.uri);
    }

    /**
     * Initialize clients from server configurations
     * @param serverConfigs Server configurations with individual connection modes
     * @returns Promise resolving when initialization is complete
     */
    async initializeFromConfig(serverConfigs: ValidatedServersConfig): Promise<void> {
        // Handle empty server configurations gracefully
        if (Object.keys(serverConfigs).length === 0) {
            this.logger.info('No MCP servers configured - running without external tools');
            return;
        }

        const successfulConnections: string[] = [];
        const connectionPromises: Promise<void>[] = [];
        const strictServers: string[] = [];
        const lenientServers: string[] = [];

        // Categorize servers by their connection mode
        for (const [name, config] of Object.entries(serverConfigs)) {
            // Skip disabled servers
            if (config.enabled === false) {
                this.logger.info(`Skipping disabled server '${name}'`);
                continue;
            }

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
                    if (!this.connectionErrors[name]) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const errorCode =
                            error && typeof error === 'object' && 'code' in error
                                ? String((error as { code?: unknown }).code)
                                : undefined;
                        this.connectionErrors[name] = {
                            message: errorMessage,
                            ...(errorCode ? { code: errorCode } : {}),
                        };
                    }
                    this.logger.debug(
                        `Handled connection error for '${name}' during initialization: ${error instanceof Error ? error.message : String(error)}`
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
                .map(
                    (name) => `${name}: ${this.connectionErrors[name]?.message ?? 'Unknown error'}`
                )
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
            this.logger.warn(`Client '${name}' is already connected or registered.`);
            return;
        }

        const client = new MCPClient(this.logger);
        client.setAuthProviderFactory(this.authProviderFactory);
        try {
            this.logger.info(`Attempting to connect to new server '${name}'...`);
            await client.connect(config, name);

            // Set approval manager if available
            if (this.approvalManager) {
                client.setApprovalManager(this.approvalManager);
            }

            this.registerClient(name, client);
            await this.updateClientCache(name, client);

            // Store config for potential restart
            this.configCache.set(name, config);

            this.logger.info(`Successfully connected and cached new server '${name}'`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorCode =
                error && typeof error === 'object' && 'code' in error
                    ? String((error as { code?: unknown }).code)
                    : undefined;
            this.connectionErrors[name] = {
                message: errorMsg,
                ...(errorCode ? { code: errorCode } : {}),
            };
            this.logger.error(`Failed to connect to new server '${name}': ${errorMsg}`);
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
    getFailedConnections(): { [key: string]: { message: string; code?: string } } {
        return this.connectionErrors;
    }

    getFailedConnectionError(name: string): string | undefined {
        return this.connectionErrors[name]?.message;
    }

    getFailedConnectionErrorCode(name: string): string | undefined {
        return this.connectionErrors[name]?.code;
    }

    getAuthProvider(name: string) {
        const client = this.clients.get(name);
        if (client instanceof MCPClient) {
            return client.getCurrentAuthProvider();
        }
        return null;
    }

    /**
     * Refresh all client caches by re-fetching capabilities from servers
     * Useful when you want to force a full refresh of tools, prompts, and resources
     * In normal operation, caches are automatically kept fresh via server notifications
     */
    async refresh(): Promise<void> {
        this.logger.debug('Refreshing all MCPManager caches...');
        const refreshPromises: Promise<void>[] = [];

        for (const [clientName, client] of this.clients.entries()) {
            refreshPromises.push(this.updateClientCache(clientName, client));
        }

        await Promise.all(refreshPromises);
        this.logger.debug(
            `✅ MCPManager cache refresh complete for ${this.clients.size} client(s)`
        );
    }

    /**
     * Disconnect and remove a specific client by name.
     * @param name The name of the client to remove.
     */
    async removeClient(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (client) {
            try {
                await client.disconnect();
                this.logger.info(`Successfully disconnected client: ${name}`);
            } catch (error) {
                this.logger.error(
                    `Error disconnecting client '${name}': ${error instanceof Error ? error.message : String(error)}`
                );
                // Continue with removal even if disconnection fails
            }
            // Clear cache BEFORE removing from clients map
            this.clearClientCache(name);
            this.clients.delete(name);
            // Remove stored config
            this.configCache.delete(name);
            this.logger.info(`Removed client from manager: ${name}`);
        }
        // Also remove from failed connections if it was registered there before successful connection or if it failed.
        if (this.connectionErrors[name]) {
            delete this.connectionErrors[name];
            this.logger.info(`Cleared connection error for removed client: ${name}`);
        }
    }

    /**
     * Restart a specific MCP server by disconnecting and reconnecting with original config.
     * @param name The name of the server to restart.
     * @throws Error if server doesn't exist or config is not cached.
     */
    async restartServer(name: string): Promise<void> {
        // Get stored config first (this is the critical check)
        const config = this.configCache.get(name);
        if (!config) {
            throw MCPError.serverNotFound(
                name,
                'Server config not found - cannot restart dynamically added servers without stored config'
            );
        }

        // Allow restart even if client is not currently registered (enables retries after failed restart)
        const client = this.clients.get(name);

        this.logger.info(`Restarting MCP server '${name}'...`);

        // Disconnect existing client if one exists
        if (client) {
            try {
                await client.disconnect();
                this.logger.info(`Disconnected server '${name}' for restart`);
            } catch (error) {
                this.logger.warn(
                    `Error disconnecting server '${name}' during restart (continuing): ${error instanceof Error ? error.message : String(error)}`
                );
            }
        } else {
            this.logger.info(
                `No active client found for '${name}' during restart; attempting fresh connection`
            );
        }

        // Clear caches but keep config
        this.clearClientCache(name);
        this.clients.delete(name);
        delete this.connectionErrors[name];

        // Reconnect with original config
        try {
            const newClient = new MCPClient(this.logger);
            newClient.setAuthProviderFactory(this.authProviderFactory);
            await newClient.connect(config, name);

            // Set approval manager if available
            if (this.approvalManager) {
                newClient.setApprovalManager(this.approvalManager);
            }

            this.registerClient(name, newClient);
            await this.updateClientCache(name, newClient);

            // Config is still in cache from original connection
            this.logger.info(`Successfully restarted server '${name}'`);

            // Emit event for restart
            eventBus.emit('mcp:server-restarted', { serverName: name });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorCode =
                error && typeof error === 'object' && 'code' in error
                    ? String((error as { code?: unknown }).code)
                    : undefined;
            this.connectionErrors[name] = {
                message: errorMsg,
                ...(errorCode ? { code: errorCode } : {}),
            };
            this.logger.error(`Failed to restart server '${name}': ${errorMsg}`);
            // Note: Config remains in cache for potential retry
            throw MCPError.connectionFailed(name, errorMsg);
        }
    }

    /**
     * Disconnect all clients and clear caches
     */
    async disconnectAll(): Promise<void> {
        const disconnectPromises: Promise<void>[] = [];
        for (const [name, client] of Array.from(this.clients.entries())) {
            disconnectPromises.push(
                client
                    .disconnect()
                    .then(() => this.logger.info(`Disconnected client: ${name}`))
                    .catch((error) =>
                        this.logger.error(`Failed to disconnect client '${name}': ${error}`)
                    )
            );
        }
        await Promise.all(disconnectPromises);

        this.clients.clear();
        this.connectionErrors = {};
        this.configCache.clear();
        this.toolCache.clear();
        this.toolConflicts.clear();
        this.promptCache.clear();
        this.resourceCache.clear();
        this.sanitizedNameToServerMap.clear();
        this.logger.info('Disconnected all clients and cleared caches.');
    }

    /**
     * Set up notification listeners for a specific client
     */
    private setupClientNotifications(clientName: string, client: IMCPClient): void {
        try {
            // Listen for resource updates
            client.on('resourceUpdated', async (params: { uri: string }) => {
                this.logger.debug(
                    `Received resource update notification from ${clientName}: ${params.uri}`
                );
                await this.handleResourceUpdated(clientName, params);
            });

            // Listen for prompt list changes
            client.on('promptsListChanged', async () => {
                this.logger.debug(`Received prompts list change notification from ${clientName}`);
                await this.handlePromptsListChanged(clientName, client);
            });

            // Listen for tool list changes
            client.on('toolsListChanged', async () => {
                this.logger.debug(`Received tools list change notification from ${clientName}`);
                await this.handleToolsListChanged(clientName, client);
            });

            this.logger.debug(`Set up notification listeners for client: ${clientName}`);
        } catch (error) {
            this.logger.warn(`Failed to set up notification listeners for ${clientName}: ${error}`);
        }
    }

    /**
     * Handle resource updated notification
     */
    private async handleResourceUpdated(
        serverName: string,
        params: { uri: string }
    ): Promise<void> {
        try {
            // Update the resource cache for this specific resource
            const client = this.clients.get(serverName);
            if (client) {
                const key = this.buildQualifiedResourceKey(serverName, params.uri);

                // Try to get updated resource info
                try {
                    const resources = await client.listResources();
                    const updatedResource = resources.find((r) => r.uri === params.uri);

                    if (updatedResource) {
                        // Update cache with new resource info
                        this.resourceCache.set(key, {
                            serverName,
                            client,
                            summary: updatedResource,
                        });
                        this.logger.debug(`Updated resource cache for: ${params.uri}`);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to refresh resource ${params.uri}: ${error}`);
                }
            }

            // Emit event to notify other parts of the system
            eventBus.emit('mcp:resource-updated', {
                serverName,
                resourceUri: params.uri,
            });
        } catch (error) {
            this.logger.error(`Error handling resource update: ${error}`);
        }
    }

    /**
     * Handle prompts list changed notification
     */
    private async handlePromptsListChanged(serverName: string, client: IMCPClient): Promise<void> {
        try {
            // Refresh the prompts for this client
            const existingPrompts = Array.from(this.promptCache.entries())
                .filter(([_, entry]) => entry.client === client)
                .map(([promptName]) => promptName);

            // Remove old prompts from cache
            existingPrompts.forEach((promptName) => {
                this.promptCache.delete(promptName);
            });

            // Add new prompts with metadata from listPrompts() (no additional network calls needed)
            try {
                const newPrompts: Prompt[] = await client.listPrompts();

                for (const prompt of newPrompts) {
                    // Convert MCP SDK Prompt to our PromptDefinition
                    const definition: PromptDefinition = {
                        name: prompt.name,
                        ...(prompt.title && { title: prompt.title }),
                        ...(prompt.description && { description: prompt.description }),
                        ...(prompt.arguments && { arguments: prompt.arguments }),
                    };

                    this.promptCache.set(prompt.name, {
                        serverName,
                        client,
                        definition,
                    });
                }

                const promptNames = newPrompts.map((p) => p.name);
                this.logger.debug(
                    `Updated prompts cache for ${serverName}: [${promptNames.join(', ')}]`
                );

                // Emit event to notify other parts of the system
                eventBus.emit('mcp:prompts-list-changed', {
                    serverName,
                    prompts: promptNames,
                });
            } catch (error) {
                this.logger.warn(`Failed to refresh prompts for ${serverName}: ${error}`);
            }
        } catch (error) {
            this.logger.error(`Error handling prompts list change: ${error}`);
        }
    }

    /**
     * Handle tools list changed notification
     */
    private async handleToolsListChanged(serverName: string, client: IMCPClient): Promise<void> {
        try {
            // Remove old tools for this client
            const removedToolBaseNames = new Set<string>();
            for (const [toolKey, entry] of Array.from(this.toolCache.entries())) {
                if (entry.serverName === serverName) {
                    const delimiterIndex = toolKey.lastIndexOf(MCPManager.SERVER_DELIMITER);
                    const baseName =
                        delimiterIndex === -1
                            ? toolKey
                            : toolKey.substring(
                                  delimiterIndex + MCPManager.SERVER_DELIMITER.length
                              );
                    removedToolBaseNames.add(baseName);
                    this.toolCache.delete(toolKey);
                }
            }

            // Fetch and cache new tools
            try {
                const tools = await client.getTools();
                const toolNames = Object.keys(tools);

                this.logger.debug(
                    `🔧 Refreshing tools from server '${serverName}': [${toolNames.join(', ')}]`
                );

                // Re-run conflict detection logic for each tool
                for (const toolName in tools) {
                    const toolDef = tools[toolName];
                    if (!toolDef) continue;

                    // Check if this tool name already exists from a different server
                    const existingEntry = this.toolCache.get(toolName);
                    if (existingEntry && existingEntry.serverName !== serverName) {
                        // Conflict detected! Move existing to qualified name
                        this.toolConflicts.add(toolName);
                        this.toolCache.delete(toolName);

                        const existingSanitized = this.sanitizeServerName(existingEntry.serverName);
                        const existingQualified = `${existingSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(existingQualified, existingEntry);

                        // Add new tool with qualified name
                        const newSanitized = this.sanitizeServerName(serverName);
                        const newQualified = `${newSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(newQualified, {
                            serverName,
                            client,
                            definition: toolDef,
                        });

                        this.logger.warn(
                            `⚠️  Tool conflict detected for '${toolName}' - using server prefixes: ${existingQualified}, ${newQualified}`
                        );
                    } else if (this.toolConflicts.has(toolName)) {
                        // This tool name is already known to be conflicted
                        const sanitizedName = this.sanitizeServerName(serverName);
                        const qualifiedName = `${sanitizedName}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(qualifiedName, {
                            serverName,
                            client,
                            definition: toolDef,
                        });
                        this.logger.debug(`✅ Tool '${qualifiedName}' cached (known conflict)`);
                    } else {
                        // No conflict, cache with simple name
                        this.toolCache.set(toolName, {
                            serverName,
                            client,
                            definition: toolDef,
                        });
                        this.logger.debug(`✅ Tool '${toolName}' mapped to ${serverName}`);
                    }
                }

                // Check for resolved conflicts from removed tools
                for (const baseName of removedToolBaseNames) {
                    const remainingTools = Array.from(this.toolCache.entries()).filter(
                        ([key, _]) => {
                            const delimiterIndex = key.lastIndexOf(MCPManager.SERVER_DELIMITER);
                            const bn =
                                delimiterIndex === -1
                                    ? key
                                    : key.substring(
                                          delimiterIndex + MCPManager.SERVER_DELIMITER.length
                                      );
                            return bn === baseName;
                        }
                    );

                    if (remainingTools.length === 0) {
                        this.toolConflicts.delete(baseName);
                    } else if (remainingTools.length === 1 && this.toolConflicts.has(baseName)) {
                        // Restore to simple name
                        const singleTool = remainingTools[0];
                        if (singleTool) {
                            const [qualifiedKey, entry] = singleTool;
                            this.toolCache.delete(qualifiedKey);
                            this.toolCache.set(baseName, entry);
                            this.toolConflicts.delete(baseName);
                            this.logger.debug(
                                `Restored tool '${baseName}' to simple name (conflict resolved)`
                            );
                        }
                    }
                }

                this.logger.debug(
                    `Updated tools cache for ${serverName}: [${toolNames.join(', ')}]`
                );

                // Emit event to notify other parts of the system
                eventBus.emit('mcp:tools-list-changed', {
                    serverName,
                    tools: toolNames,
                });
            } catch (error) {
                this.logger.warn(`Failed to refresh tools for ${serverName}: ${error}`);
            }
        } catch (error) {
            this.logger.error(`Error handling tools list change: ${error}`);
        }
    }
}
