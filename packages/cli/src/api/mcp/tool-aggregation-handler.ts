import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCPManager, MCPErrorCode, type ValidatedServersConfig } from '@dexto/core/mcp';
import { createLogger, DextoLogComponent } from '@dexto/core/logger';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    McpError,
    ErrorCode,
    type Tool,
    type Resource,
    type Prompt,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Initializes MCP server for tool aggregation mode.
 * Instead of exposing an AI agent, this directly exposes all tools from connected MCP servers.
 */
export async function initializeMcpToolAggregationServer(
    serverConfigs: ValidatedServersConfig,
    mcpTransport: Transport,
    serverName: string,
    serverVersion: string,
    strict: boolean
): Promise<McpServer> {
    // Manager diagnostics can contain upstream payloads; keep them off protocol streams.
    const mcpLogger = createLogger({
        config: {
            level: 'info',
            transports: [{ type: 'silent' }],
        },
        agentId: 'mcp-tool-aggregation',
        component: DextoLogComponent.MCP,
    });
    const mcpManager = new MCPManager(mcpLogger);

    const mcpServer = new McpServer(
        { name: serverName, version: serverVersion },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        }
    );

    const closeServer = mcpServer.close.bind(mcpServer);
    let closePromise: Promise<void> | undefined;
    mcpServer.close = () => {
        closePromise ??= Promise.resolve().then(async () => {
            const results = await Promise.allSettled([closeServer(), mcpManager.disconnectAll()]);
            results.push(...(await Promise.allSettled([mcpLogger.destroy()])));
            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length > 0) {
                throw new AggregateError(
                    failures.map((result) => result.reason),
                    'MCP aggregation cleanup failed'
                );
            }
        });
        return closePromise;
    };
    const onclose = mcpServer.server.onclose;
    mcpServer.server.onclose = () => {
        try {
            onclose?.();
        } finally {
            void mcpServer.close().catch(() => undefined);
        }
    };

    const connectionConfigs: ValidatedServersConfig = { ...serverConfigs };
    if (strict) {
        for (const [name, config] of Object.entries(serverConfigs)) {
            if (config.enabled) connectionConfigs[name] = { ...config, connectionMode: 'strict' };
        }
    }
    try {
        await mcpManager.initializeFromConfig(connectionConfigs);
        if (
            Object.values(mcpManager.getFailedConnections()).some(
                (error) => error.code === MCPErrorCode.DUPLICATE_NAME
            )
        ) {
            throw new Error('Duplicate upstream server identity');
        }

        const tools = new Map<
            string,
            { definition: Tool; client: Client; name: string; timeout: number }
        >();
        const discovered = new Map<
            string,
            {
                client: Client;
                tools: Map<string, Tool>;
                resources: Map<string, Resource>;
                prompts: Prompt[];
                timeout: number;
            }
        >();
        await Promise.all(
            Array.from(mcpManager.getClients(), async ([name, connection]) => {
                const config = serverConfigs[name];
                if (config === undefined)
                    throw new Error('Missing upstream connection configuration');
                const client = await connection.getConnectedClient();
                const capabilities = client.getServerCapabilities();
                const options = { timeout: config.timeout };
                const [toolResult, resourceResult, promptResult] = await Promise.all([
                    capabilities?.tools ? client.listTools(undefined, options) : { tools: [] },
                    capabilities?.resources
                        ? client.listResources(undefined, options)
                        : { resources: [] },
                    capabilities?.prompts
                        ? client.listPrompts(undefined, options)
                        : { prompts: [] },
                ]);
                const upstreamTools = new Map(toolResult.tools.map((tool) => [tool.name, tool]));
                if (upstreamTools.size !== toolResult.tools.length)
                    throw new Error('Duplicate upstream tool identity');
                const upstreamResources = new Map(
                    resourceResult.resources.map((resource) => [resource.uri, resource])
                );
                if (upstreamResources.size !== resourceResult.resources.length)
                    throw new Error('Duplicate upstream resource identity');
                discovered.set(name, {
                    client,
                    tools: upstreamTools,
                    resources: upstreamResources,
                    prompts: promptResult.prompts,
                    timeout: config.timeout,
                });
            })
        );
        let discoveredCount = 0;
        for (const upstream of discovered.values()) discoveredCount += upstream.tools.size;
        const aliases = mcpManager.getAllToolsWithServerInfo();
        if (aliases.size !== discoveredCount) throw new Error('Ambiguous aggregation tool aliases');
        for (const [alias, entry] of aliases) {
            const upstream = discovered.get(entry.serverName);
            const definition = upstream?.tools.get(entry.upstreamToolName);
            if (upstream === undefined || definition === undefined) {
                throw new Error('Aggregation tool identity changed during startup');
            }
            tools.set(alias, {
                definition: { ...definition, name: alias },
                client: upstream.client,
                name: entry.upstreamToolName,
                timeout: upstream.timeout,
            });
        }
        mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: Array.from(tools.values(), (tool) => tool.definition),
        }));
        mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            const tool = tools.get(request.params.name);
            if (tool === undefined)
                throw new McpError(ErrorCode.InvalidParams, 'Unknown aggregation tool');
            return tool.client.callTool({ ...request.params, name: tool.name }, undefined, {
                signal: extra.signal,
                timeout: tool.timeout,
            });
        });

        const resources = new Map<
            string,
            { definition: Resource; client: Client; uri: string; timeout: number }
        >();
        const cachedResources = await mcpManager.listAllResources();
        let discoveredResourceCount = 0;
        for (const upstream of discovered.values())
            discoveredResourceCount += upstream.resources.size;
        if (cachedResources.length !== discoveredResourceCount)
            throw new Error('Ambiguous aggregation resource identities');
        for (const resource of cachedResources) {
            const upstream = discovered.get(resource.serverName);
            const definition = upstream?.resources.get(resource.summary.uri);
            if (upstream === undefined || definition === undefined)
                throw new Error('Aggregation resource identity changed during startup');
            resources.set(resource.key, {
                definition: { ...definition, uri: resource.key },
                client: upstream.client,
                uri: definition.uri,
                timeout: upstream.timeout,
            });
        }
        mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: Array.from(resources.values(), (resource) => resource.definition),
        }));
        mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
            const resource = resources.get(request.params.uri);
            if (resource === undefined)
                throw new McpError(ErrorCode.InvalidParams, 'Unknown aggregation resource');
            return resource.client.readResource(
                { ...request.params, uri: resource.uri },
                { signal: extra.signal, timeout: resource.timeout }
            );
        });
        const prompts = new Map<string, { definition: Prompt; client: Client; timeout: number }>();
        for (const upstream of discovered.values()) {
            for (const prompt of upstream.prompts) {
                if (prompts.has(prompt.name))
                    throw new Error('Duplicate aggregation prompt identity');
                prompts.set(prompt.name, {
                    definition: prompt,
                    client: upstream.client,
                    timeout: upstream.timeout,
                });
            }
        }
        mcpServer.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
            prompts: Array.from(prompts.values(), (prompt) => prompt.definition),
        }));
        mcpServer.server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
            const prompt = prompts.get(request.params.name);
            if (prompt === undefined)
                throw new McpError(ErrorCode.InvalidParams, 'Unknown aggregation prompt');
            return prompt.client.getPrompt(request.params, {
                signal: extra.signal,
                timeout: prompt.timeout,
            });
        });

        await mcpServer.connect(mcpTransport);

        return mcpServer;
    } catch (error) {
        await mcpServer.close().catch(() => undefined);
        throw error;
    }
}
