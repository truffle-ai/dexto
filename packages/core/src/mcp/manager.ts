import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type {
    GetPromptResult,
    ReadResourceResult,
    Prompt,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPResolvedResource, MCPResourceSummary } from './types.js';
import type { MCPToolDescriptor, ToolSet } from '../tools/types.js';
import { MCPError } from './errors.js';
import { eventBus, type AgentEventBus } from '../events/index.js';
import type { PromptDefinition } from '../prompts/types.js';
import type {
    MCPConnection,
    MCPConnectionCallContext,
    MCPConnectionChange,
    MCPConnectionLayer,
} from './connection-layer.js';
import { toolSchemaFingerprint } from '../tools/schema-fingerprint.js';
import { stableFingerprint } from '../utils/stable-fingerprint.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';

/** Normalizes and dispatches capabilities supplied by one host-owned MCP connection layer. */
type ResourceCacheEntry = {
    serverName: string;
    connection: MCPConnection;
    summary: MCPResourceSummary;
};

type PromptCacheEntry = {
    serverName: string;
    connection: MCPConnection;
    definition: PromptDefinition;
};

type ToolCacheEntry = {
    serverName: string;
    connection: MCPConnection;
    upstreamToolName: string;
    definition: ToolSet[string];
};

type CachedToolInputValidator = {
    schemaFingerprint: string;
    validate: JsonSchemaValidator<Record<string, unknown>>;
};

function isJsonSchemaObject(value: unknown): value is JsonSchemaType {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type CatalogLoad<T> = { status: 'loaded'; value: T } | { status: 'failed' };

type ConnectionCatalog = {
    connection: MCPConnection;
    tools: CatalogLoad<ToolSet>;
    prompts: CatalogLoad<Prompt[]>;
    resources: CatalogLoad<MCPResourceSummary[]>;
};

export class MCPManager {
    private connections = new Map<string, MCPConnection>();
    private toolCatalogs = new Map<string, ToolSet>();
    private toolCache = new Map<string, ToolCacheEntry>();
    private toolInputValidators = new Map<string, CachedToolInputValidator>();
    private toolConflicts = new Set<string>();
    private promptCache = new Map<string, PromptCacheEntry>();
    private resourceCache = new Map<string, ResourceCacheEntry>();
    private stopListening: (() => void) | undefined;
    private pendingCatalogChange: Promise<void> = Promise.resolve();
    private readonly connectionLayer: MCPConnectionLayer;
    private readonly logger: Logger;
    private readonly eventBus: AgentEventBus;
    private readonly jsonSchemaValidator = new CfWorkerJsonSchemaValidator();

    // Use a distinctive delimiter that won't appear in normal server/tool names
    // Using double hyphen as it's allowed in LLM tool name patterns (^[a-zA-Z0-9_-]+$)
    private static readonly SERVER_DELIMITER = '--';

    constructor(
        connectionLayer: MCPConnectionLayer,
        logger: Logger,
        eventBusOverride?: AgentEventBus
    ) {
        this.connectionLayer = connectionLayer;
        this.logger = logger.createChild(DextoLogComponent.MCP);
        this.eventBus = eventBusOverride ?? eventBus;
    }

    async initialize(): Promise<void> {
        if (this.stopListening) return;

        this.stopListening = this.connectionLayer.onChange((change) =>
            this.serializeCatalogChange(() => this.handleChange(change))
        );
        try {
            await this.serializeCatalogChange(() => this.syncConnections());
        } catch (error) {
            this.stopListening();
            this.stopListening = undefined;
            throw error;
        }
    }

    private serializeCatalogChange(operation: () => Promise<void>): Promise<void> {
        const result = this.pendingCatalogChange.then(operation);
        this.pendingCatalogChange = result.catch(() => undefined);
        return result;
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

    /** Ensures display names are safe when used in conflict aliases. */
    private sanitizeServerName(serverName: string): string {
        return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private toolNamespace(entry: ToolCacheEntry, namespaceCount: number): string {
        const friendlyName = this.sanitizeServerName(entry.connection.name);
        if (namespaceCount === 1) return friendlyName;
        return `${friendlyName}_${stableFingerprint(entry.connection.id).slice(0, 16)}`;
    }

    private async loadTools(connection: MCPConnection): Promise<CatalogLoad<ToolSet>> {
        try {
            const tools = this.normalizeTools(await connection.listTools());
            this.logger.debug(
                `🔧 Discovered ${Object.keys(tools).length} tools from connection '${connection.name}': [${Object.keys(tools).join(', ')}]`
            );
            return { status: 'loaded', value: tools };
        } catch (error) {
            this.logger.error(
                `❌ Error retrieving tools for connection ${connection.name}: ${error instanceof Error ? error.message : String(error)}`
            );
            return { status: 'failed' };
        }
    }

    private normalizeTools(tools: readonly Tool[]): ToolSet {
        return Object.fromEntries(
            tools.map((tool) => [
                tool.name,
                {
                    description: tool.description ?? '',
                    parameters: tool.inputSchema,
                    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
                    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
                    ...(tool._meta === undefined ? {} : { _meta: tool._meta }),
                },
            ])
        );
    }

    private async loadPrompts(connection: MCPConnection): Promise<CatalogLoad<Prompt[]>> {
        try {
            const prompts = connection.prompts ? await connection.prompts.list() : [];
            return { status: 'loaded', value: prompts };
        } catch (error) {
            this.logger.debug(`Skipping prompts for connection ${connection.name}: ${error}`);
            return { status: 'failed' };
        }
    }

    private async loadResources(
        connection: MCPConnection
    ): Promise<CatalogLoad<MCPResourceSummary[]>> {
        try {
            const resources = connection.resources ? await connection.resources.list() : [];
            return { status: 'loaded', value: resources };
        } catch (error) {
            this.logger.debug(`Skipping resources for connection ${connection.name}: ${error}`);
            return { status: 'failed' };
        }
    }

    private async loadConnectionCatalog(connection: MCPConnection): Promise<ConnectionCatalog> {
        const [tools, prompts, resources] = await Promise.all([
            this.loadTools(connection),
            this.loadPrompts(connection),
            this.loadResources(connection),
        ]);
        return { connection, tools, prompts, resources };
    }

    private rebuildToolCache(): void {
        const providers = new Map<string, ToolCacheEntry[]>();

        for (const connection of this.connections.values()) {
            const tools = this.toolCatalogs.get(connection.id) ?? {};
            for (const [toolName, definition] of Object.entries(tools)) {
                const entries = providers.get(toolName) ?? [];
                entries.push({
                    serverName: connection.id,
                    connection,
                    upstreamToolName: toolName,
                    definition,
                });
                providers.set(toolName, entries);
            }
        }

        this.toolCache.clear();
        this.toolInputValidators.clear();
        this.toolConflicts.clear();
        for (const [toolName, entries] of providers) {
            if (entries.length === 1) {
                for (const entry of entries) this.toolCache.set(toolName, entry);
                continue;
            }

            this.toolConflicts.add(toolName);
            const namespaceCounts = new Map<string, number>();
            for (const entry of entries) {
                const namespace = this.sanitizeServerName(entry.connection.name);
                namespaceCounts.set(namespace, (namespaceCounts.get(namespace) ?? 0) + 1);
            }
            for (const entry of entries) {
                const friendlyName = this.sanitizeServerName(entry.connection.name);
                const namespace = this.toolNamespace(entry, namespaceCounts.get(friendlyName) ?? 1);
                const alias = `${namespace}${MCPManager.SERVER_DELIMITER}${toolName}`;
                if (this.toolCache.has(alias)) {
                    throw MCPError.duplicateName(entry.connection.name, entry.connection.name);
                }
                this.toolCache.set(alias, entry);
            }
        }
    }

    private replacePrompts(connection: MCPConnection, prompts: Prompt[]): void {
        for (const [name, entry] of this.promptCache) {
            if (entry.serverName === connection.id) this.promptCache.delete(name);
        }
        for (const prompt of prompts) {
            this.promptCache.set(prompt.name, {
                serverName: connection.id,
                connection,
                definition: {
                    name: prompt.name,
                    ...(prompt.title ? { title: prompt.title } : {}),
                    ...(prompt.description ? { description: prompt.description } : {}),
                    ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
                },
            });
        }
    }

    private replaceResources(connection: MCPConnection, resources: MCPResourceSummary[]): void {
        for (const [key, entry] of this.resourceCache) {
            if (entry.serverName === connection.id) this.resourceCache.delete(key);
        }
        for (const summary of resources) {
            this.resourceCache.set(this.buildQualifiedResourceKey(connection.id, summary.uri), {
                serverName: connection.id,
                connection,
                summary,
            });
        }
    }

    private emitToolsChanged(connectionId: string, tools: string[]): void {
        try {
            this.eventBus.emit('mcp:tools-list-changed', {
                serverName: connectionId,
                tools,
            });
        } catch (error) {
            this.logger.error(
                `MCP tool catalog listener failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private emitPromptsChanged(connectionId: string, prompts: string[]): void {
        try {
            this.eventBus.emit('mcp:prompts-list-changed', {
                serverName: connectionId,
                prompts,
            });
        } catch (error) {
            this.logger.error(
                `MCP prompt catalog listener failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private emitResourceChanged(connectionId: string, uri: string): void {
        try {
            this.eventBus.emit('mcp:resource-updated', {
                serverName: connectionId,
                resourceUri: uri,
            });
        } catch (error) {
            this.logger.error(
                `MCP resource listener failed: ${error instanceof Error ? error.message : String(error)}`
            );
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
                        ? `${toolDef.description} (via ${entry.connection.name})`
                        : `Tool from ${entry.connection.name}`,
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
     * Describe cached MCP tools without provider-specific schema wrapping.
     * The callable name may change when conflicts appear, while identity remains connection-based.
     */
    getToolDescriptors(): MCPToolDescriptor[] {
        return Array.from(this.toolCache.entries(), ([name, entry]) =>
            this.buildToolDescriptor(name, entry)
        );
    }

    getToolDescriptor(name: string): MCPToolDescriptor | undefined {
        const entry = this.toolCache.get(name);
        return entry === undefined ? undefined : this.buildToolDescriptor(name, entry);
    }

    validateToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
        const entry = this.toolCache.get(toolName);
        if (entry === undefined) {
            throw MCPError.toolNotFound(toolName);
        }

        const schemaFingerprint = toolSchemaFingerprint(entry.definition.parameters);
        let cached = this.toolInputValidators.get(toolName);
        if (cached?.schemaFingerprint !== schemaFingerprint) {
            const inputSchema: unknown = entry.definition.parameters;
            if (!isJsonSchemaObject(inputSchema)) {
                throw MCPError.invalidToolSchema(entry.upstreamToolName, 'expected an object');
            }
            try {
                cached = {
                    schemaFingerprint,
                    validate:
                        this.jsonSchemaValidator.getValidator<Record<string, unknown>>(inputSchema),
                };
            } catch (error) {
                throw MCPError.invalidToolSchema(
                    entry.upstreamToolName,
                    error instanceof Error ? error.message : String(error)
                );
            }
            this.toolInputValidators.set(toolName, cached);
        }

        const result = cached.validate(input);
        if (!result.valid) {
            throw MCPError.invalidToolArguments(entry.upstreamToolName, result.errorMessage);
        }
        return result.data;
    }

    private buildToolDescriptor(name: string, entry: ToolCacheEntry): MCPToolDescriptor {
        return {
            name,
            description: entry.definition.description ?? '',
            identity: {
                type: 'mcp',
                connectionId: entry.serverName,
                toolName: entry.upstreamToolName,
            },
            inputSchema: entry.definition.parameters,
            ...(entry.definition.outputSchema !== undefined
                ? { outputSchema: entry.definition.outputSchema }
                : {}),
            ...(entry.definition.annotations !== undefined
                ? { annotations: entry.definition.annotations }
                : {}),
            schemaFingerprint: toolSchemaFingerprint(
                entry.definition.parameters,
                entry.definition.outputSchema
            ),
        };
    }

    /**
     * Get all MCP tools with their server metadata.
     * This returns the internal tool cache entries which include server names.
     * @returns Map of tool names to their cache entries.
     */
    getAllToolsWithServerInfo(): Map<string, ToolCacheEntry> {
        return new Map(this.toolCache);
    }

    /**
     * Get the raw connection that provides a specific tool from the cache.
     * Handles both simple tool names and server-prefixed tool names.
     * @param toolName Name of the tool (may include server prefix)
     * @returns The connection that provides the tool, or undefined if not found
     */
    getToolConnection(toolName: string): MCPConnection | undefined {
        // Try to get directly from cache (handles both simple and qualified names)
        return this.toolCache.get(toolName)?.connection;
    }

    /**
     * Execute a specific MCP tool with the given arguments.
     * @param toolName Name of the MCP tool to execute (may include server prefix)
     * @param args Arguments to pass to the tool
     * @param sessionId Optional session ID
     * @param runContext Optional execution-scoped context for this tool call
     * @returns Promise resolving to the tool execution result
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        context?: MCPConnectionCallContext
    ): Promise<unknown> {
        const entry = this.toolCache.get(toolName);
        if (!entry) {
            this.logger.error(`❌ No MCP tool found: ${toolName}`);
            this.logger.debug(
                `Available MCP tools: ${Array.from(this.toolCache.keys()).join(', ')}`
            );
            this.logger.debug(`Conflicted tools: ${Array.from(this.toolConflicts).join(', ')}`);
            throw MCPError.toolNotFound(toolName);
        }

        // Extract actual tool name (remove server prefix if present)
        const actualToolName = entry.upstreamToolName;
        const validatedArgs = this.validateToolInput(toolName, args);
        const serverName = entry.connection.name;

        this.logger.debug(
            `▶️  Executing MCP tool '${actualToolName}' on server '${serverName}'...`
        );

        try {
            const result = await entry.connection.callTool(actualToolName, validatedArgs, context);
            return result;
        } catch (error) {
            this.logger.error(
                `❌ MCP tool execution failed: '${actualToolName}' - ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get all available prompt names from the normalized cache.
     * @returns Promise resolving to an array of unique prompt names.
     */
    async listAllPrompts(): Promise<string[]> {
        return Array.from(this.promptCache.keys());
    }

    /**
     * Get the raw connection that provides a specific prompt.
     * @param promptName Name of the prompt.
     * @returns The connection or undefined.
     */
    getPromptConnection(promptName: string): MCPConnection | undefined {
        return this.promptCache.get(promptName)?.connection;
    }

    /**
     * Get a specific prompt definition by name.
     * @param name Name of the prompt.
     * @param args Arguments for the prompt (optional).
     * @returns Promise resolving to the prompt definition.
     */
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const connection = this.getPromptConnection(name);
        if (!connection?.prompts) {
            throw MCPError.promptNotFound(name);
        }
        return await connection.prompts.get(name, args);
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
        if (!entry.connection.resources) {
            throw MCPError.resourceNotFound(resourceKey);
        }
        return await entry.connection.resources.read(entry.summary.uri);
    }

    async refresh(): Promise<void> {
        await this.serializeCatalogChange(() => this.syncConnections());
    }

    async close(): Promise<void> {
        this.stopListening?.();
        this.stopListening = undefined;
        await this.pendingCatalogChange;
        await this.connectionLayer.close();
        this.connections.clear();
        this.toolCatalogs.clear();
        this.toolCache.clear();
        this.toolInputValidators.clear();
        this.toolConflicts.clear();
        this.promptCache.clear();
        this.resourceCache.clear();
        this.logger.info('Closed MCP connections and cleared caches.');
    }

    private async syncConnections(): Promise<void> {
        const connections = await this.connectionLayer.listConnections();
        const nextConnections = new Map<string, MCPConnection>();

        for (const connection of connections) {
            if (nextConnections.has(connection.id)) {
                throw MCPError.duplicateName(connection.id, connection.id);
            }
            nextConnections.set(connection.id, connection);
        }

        const catalogs = await Promise.all(
            connections.map((connection) => this.loadConnectionCatalog(connection))
        );
        this.connections = nextConnections;
        this.toolCatalogs.clear();
        this.promptCache.clear();
        this.resourceCache.clear();
        for (const catalog of catalogs) {
            if (catalog.tools.status === 'loaded') {
                this.toolCatalogs.set(catalog.connection.id, catalog.tools.value);
            }
            if (catalog.prompts.status === 'loaded') {
                this.replacePrompts(catalog.connection, catalog.prompts.value);
            }
            if (catalog.resources.status === 'loaded') {
                this.replaceResources(catalog.connection, catalog.resources.value);
            }
        }
        this.rebuildToolCache();
    }

    private async handleChange(change: MCPConnectionChange): Promise<void> {
        if (change.type === 'connections-changed') {
            const previousConnectionIds = Array.from(this.connections.keys());
            await this.syncConnections();
            const affectedConnectionIds = new Set([
                ...previousConnectionIds,
                ...this.connections.keys(),
            ]);
            for (const connectionId of affectedConnectionIds) {
                this.emitToolsChanged(
                    connectionId,
                    Object.keys(this.toolCatalogs.get(connectionId) ?? {})
                );
                this.emitPromptsChanged(
                    connectionId,
                    Array.from(this.promptCache.entries())
                        .filter(([, entry]) => entry.serverName === connectionId)
                        .map(([name]) => name)
                );
            }
            return;
        }

        const connection = this.connections.get(change.connectionId);
        if (!connection) {
            await this.syncConnections();
            return;
        }

        if (change.type === 'tools-changed') {
            const tools = await this.loadTools(connection);
            if (tools.status === 'failed') return;
            this.toolCatalogs.set(connection.id, tools.value);
            this.rebuildToolCache();
            this.emitToolsChanged(connection.id, Object.keys(tools.value));
        } else if (change.type === 'prompts-changed') {
            const prompts = await this.loadPrompts(connection);
            if (prompts.status === 'failed') return;
            this.replacePrompts(connection, prompts.value);
            this.emitPromptsChanged(
                connection.id,
                prompts.value.map((prompt) => prompt.name)
            );
        } else {
            const resources = await this.loadResources(connection);
            if (resources.status === 'failed') return;
            this.replaceResources(connection, resources.value);
            if (change.type !== 'resource-changed') return;
            this.emitResourceChanged(connection.id, change.uri);
        }
    }
}
