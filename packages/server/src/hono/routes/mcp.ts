import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger, McpServerConfigSchema } from '@dexto/core';
import { ToolSchema, ResourceSchema } from '../schemas/responses.js';

const McpServerRequestSchema = z.object({
    name: z.string().min(1, 'Server name is required').describe('A unique name for the server'),
    config: McpServerConfigSchema.describe('The server configuration object'),
    persistToAgent: z
        .boolean()
        .optional()
        .describe('If true, saves the server to agent configuration file'),
});

const ExecuteToolBodySchema = z
    .any()
    .describe(
        'Tool execution parameters - schema will be tightened once tool input structure is standardised'
    );

// Response schemas
const ServerStatusResponseSchema = z
    .object({
        status: z.string().describe('Connection status'),
        name: z.string().describe('Server name'),
    })
    .strict()
    .describe('Server status response');

const ServerInfoSchema = z
    .object({
        id: z.string().describe('Server identifier'),
        name: z.string().describe('Server name'),
        status: z.string().describe('Server status (connected or error)'),
    })
    .strict()
    .describe('MCP server information');

const ServersListResponseSchema = z
    .object({
        servers: z.array(ServerInfoSchema).describe('Array of server information'),
    })
    .strict()
    .describe('List of MCP servers');

const ToolInfoSchema = z
    .object({
        id: z.string().describe('Tool identifier'),
        name: z.string().describe('Tool name'),
        description: z.string().describe('Tool description'),
        inputSchema: z.record(z.any()).describe('JSON Schema for tool input parameters'),
    })
    .strict()
    .describe('Tool information');

const ToolsListResponseSchema = z
    .object({
        tools: z.array(ToolInfoSchema).describe('Array of available tools'),
    })
    .strict()
    .describe('List of tools from MCP server');

const DisconnectResponseSchema = z
    .object({
        status: z.literal('disconnected').describe('Disconnection status'),
        id: z.string().describe('Server identifier'),
    })
    .strict()
    .describe('Server disconnection response');

const RestartResponseSchema = z
    .object({
        status: z.literal('restarted').describe('Restart status'),
        id: z.string().describe('Server identifier'),
    })
    .strict()
    .describe('Server restart response');

const ToolExecutionResponseSchema = z
    .object({
        success: z.boolean().describe('Whether tool execution succeeded'),
        data: z.any().optional().describe('Tool execution result data'),
        error: z.string().optional().describe('Error message if execution failed'),
    })
    .strict()
    .describe('Tool execution response');

const ResourcesListResponseSchema = z
    .object({
        success: z.boolean().describe('Success indicator'),
        resources: z.array(ResourceSchema).describe('Array of available resources'),
    })
    .strict()
    .describe('List of resources from MCP server');

const ResourceContentSchema = z
    .object({
        content: z.any().describe('Resource content data'),
    })
    .strict()
    .describe('Resource content wrapper');

const ResourceContentResponseSchema = z
    .object({
        success: z.boolean().describe('Success indicator'),
        data: ResourceContentSchema.describe('Resource content'),
    })
    .strict()
    .describe('Resource content response');

export function createMcpRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const addServerRoute = createRoute({
        method: 'post',
        path: '/mcp/servers',
        summary: 'Add MCP Server',
        description: 'Connects a new MCP server dynamically',
        tags: ['mcp'],
        request: { body: { content: { 'application/json': { schema: McpServerRequestSchema } } } },
        responses: {
            200: {
                description: 'Server connected',
                content: { 'application/json': { schema: ServerStatusResponseSchema } },
            },
        },
    });
    app.openapi(addServerRoute, async (ctx) => {
        const agent = getAgent();
        const { name, config, persistToAgent } = ctx.req.valid('json');

        // Connect the server
        await agent.connectMcpServer(name, config);
        logger.info(`Successfully connected to new server '${name}' via API request.`);

        // If persistToAgent is true, save to agent config file
        if (persistToAgent === true) {
            try {
                // Get the current effective config to read existing mcpServers
                const currentConfig = agent.getEffectiveConfig();

                // Create update with new server added to mcpServers
                const updates = {
                    mcpServers: {
                        ...(currentConfig.mcpServers || {}),
                        [name]: config,
                    },
                };

                await agent.updateAndSaveConfig(updates);
                logger.info(`Saved server '${name}' to agent configuration file`);
            } catch (saveError) {
                logger.warn(`Failed to save server '${name}' to agent config:`, saveError);
                // Don't fail the request if saving fails - server is still connected
            }
        }

        return ctx.json({ status: 'connected', name }, 200);
    });

    const listServersRoute = createRoute({
        method: 'get',
        path: '/mcp/servers',
        summary: 'List MCP Servers',
        description: 'Gets a list of all connected and failed MCP servers',
        tags: ['mcp'],
        responses: {
            200: {
                description: 'Servers list',
                content: { 'application/json': { schema: ServersListResponseSchema } },
            },
        },
    });
    app.openapi(listServersRoute, async (ctx) => {
        const agent = getAgent();
        const clientsMap = agent.getMcpClients();
        const failedConnections = agent.getMcpFailedConnections();
        const servers: Array<{ id: string; name: string; status: string }> = [];
        for (const name of clientsMap.keys()) {
            servers.push({ id: name, name, status: 'connected' });
        }
        for (const name of Object.keys(failedConnections)) {
            servers.push({ id: name, name, status: 'error' });
        }
        return ctx.json({ servers });
    });

    const toolsRoute = createRoute({
        method: 'get',
        path: '/mcp/servers/{serverId}/tools',
        summary: 'List Server Tools',
        description: 'Retrieves the list of tools available on a specific MCP server',
        tags: ['mcp'],
        request: {
            params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
        },
        responses: {
            200: {
                description: 'Tools list',
                content: { 'application/json': { schema: ToolsListResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(toolsRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId } = ctx.req.valid('param');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return ctx.json({ error: `Server '${serverId}' not found` }, 404);
        }
        const toolsMap = await client.getTools();
        const tools = Object.entries(toolsMap).map(([toolName, toolDef]) => ({
            id: toolName,
            name: toolName,
            description: toolDef.description || '',
            inputSchema: toolDef.parameters,
        }));
        return ctx.json({ tools });
    });

    const deleteServerRoute = createRoute({
        method: 'delete',
        path: '/mcp/servers/{serverId}',
        summary: 'Remove MCP Server',
        description: 'Disconnects and removes an MCP server',
        tags: ['mcp'],
        request: {
            params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
        },
        responses: {
            200: {
                description: 'Disconnected',
                content: { 'application/json': { schema: DisconnectResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(deleteServerRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId } = ctx.req.valid('param');
        const clientExists =
            agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
        if (!clientExists) {
            return ctx.json({ error: `Server '${serverId}' not found.` }, 404);
        }

        await agent.removeMcpServer(serverId);
        return ctx.json({ status: 'disconnected', id: serverId });
    });

    const restartServerRoute = createRoute({
        method: 'post',
        path: '/mcp/servers/{serverId}/restart',
        summary: 'Restart MCP Server',
        description: 'Restarts a connected MCP server',
        tags: ['mcp'],
        request: {
            params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
        },
        responses: {
            200: {
                description: 'Server restarted',
                content: { 'application/json': { schema: RestartResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(restartServerRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId } = ctx.req.valid('param');
        logger.info(`Received request to POST /api/mcp/servers/${serverId}/restart`);

        const clientExists = agent.getMcpClients().has(serverId);
        if (!clientExists) {
            logger.warn(`Attempted to restart non-existent server: ${serverId}`);
            return ctx.json({ error: `Server '${serverId}' not found.` }, 404);
        }

        await agent.restartMcpServer(serverId);
        return ctx.json({ status: 'restarted', id: serverId });
    });

    const execToolRoute = createRoute({
        method: 'post',
        path: '/mcp/servers/{serverId}/tools/{toolName}/execute',
        summary: 'Execute MCP Tool',
        description: 'Executes a tool on an MCP server directly',
        tags: ['mcp'],
        request: {
            params: z.object({
                serverId: z.string().describe('The ID of the MCP server'),
                toolName: z.string().describe('The name of the tool to execute'),
            }),
            body: { content: { 'application/json': { schema: ExecuteToolBodySchema } } },
        },
        responses: {
            200: {
                description: 'Tool executed',
                content: { 'application/json': { schema: ToolExecutionResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(execToolRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId, toolName } = ctx.req.valid('param');
        const body = ExecuteToolBodySchema.parse(await ctx.req.json());
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return ctx.json({ success: false, error: `Server '${serverId}' not found` }, 404);
        }
        // Execute tool directly on the specified server (matches Express implementation)
        const rawResult = await client.callTool(toolName, body);
        return ctx.json({ success: true, data: rawResult });
    });

    const listResourcesRoute = createRoute({
        method: 'get',
        path: '/mcp/servers/{serverId}/resources',
        summary: 'List Server Resources',
        description: 'Retrieves all resources available from a specific MCP server',
        tags: ['mcp'],
        request: {
            params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
        },
        responses: {
            200: {
                description: 'Server resources',
                content: { 'application/json': { schema: ResourcesListResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(listResourcesRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId } = ctx.req.valid('param');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return ctx.json({ error: `Server '${serverId}' not found` }, 404);
        }
        const resources = await agent.listResourcesForServer(serverId);
        return ctx.json({ success: true, resources });
    });

    const getResourceContentRoute = createRoute({
        method: 'get',
        path: '/mcp/servers/{serverId}/resources/{resourceId}/content',
        summary: 'Read Server Resource Content',
        description:
            'Reads content from a specific resource on an MCP server. This endpoint automatically constructs the qualified URI format (mcp:serverId:resourceId)',
        tags: ['mcp'],
        request: {
            params: z.object({
                serverId: z.string().describe('The ID of the MCP server'),
                resourceId: z
                    .string()
                    .min(1, 'Resource ID is required')
                    .transform((encoded) => decodeURIComponent(encoded))
                    .describe('The URI-encoded resource identifier on that server'),
            }),
        },
        responses: {
            200: {
                description: 'Resource content',
                content: { 'application/json': { schema: ResourceContentResponseSchema } },
            },
            404: { description: 'Not found' },
        },
    });
    app.openapi(getResourceContentRoute, async (ctx) => {
        const agent = getAgent();
        const { serverId, resourceId } = ctx.req.valid('param');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return ctx.json({ error: `Server '${serverId}' not found` }, 404);
        }
        const qualifiedUri = `mcp:${serverId}:${resourceId}`;
        const content = await agent.readResource(qualifiedUri);
        return ctx.json({ success: true, data: { content } });
    });

    return app;
}
