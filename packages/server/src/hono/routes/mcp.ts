import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger, McpServerConfigSchema } from '@dexto/core';

const ConnectServerSchema = z.object({
    name: z.string().min(1, 'Server name is required'),
    config: McpServerConfigSchema,
    persistToAgent: z.boolean().optional(),
});

const ServerParamSchema = z.object({
    serverId: z.string(),
});

const ExecuteToolParams = z.object({
    serverId: z.string(),
    toolName: z.string(),
});

const ExecuteToolBodySchema = z.any(); // TODO: tighten schema once tool input structure is standardised.

export function createMcpRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const connectRoute = createRoute({
        method: 'post',
        path: '/connect-server',
        tags: ['mcp'],
        request: { body: { content: { 'application/json': { schema: ConnectServerSchema } } } },
        responses: {
            200: { description: 'Connected', content: { 'application/json': { schema: z.any() } } },
        },
    });
    app.openapi(connectRoute, async (ctx) => {
        const agent = getAgent();
        const { name, config, persistToAgent } = ctx.req.valid('json');
        await agent.connectMcpServer(name, config);

        // If persistToAgent is true, save to agent config file
        if (persistToAgent === true) {
            try {
                const currentConfig = agent.getEffectiveConfig();
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
            }
        }

        logger.info(`Successfully connected to new server '${name}' via API request.`);
        return ctx.json({ status: 'connected', name });
    });

    const addServerRoute = createRoute({
        method: 'post',
        path: '/mcp/servers',
        tags: ['mcp'],
        request: { body: { content: { 'application/json': { schema: ConnectServerSchema } } } },
        responses: {
            201: {
                description: 'Server added',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(addServerRoute, async (ctx) => {
        const agent = getAgent();
        const { name, config, persistToAgent } = ctx.req.valid('json');
        await agent.connectMcpServer(name, config);

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

        return ctx.json({ status: 'connected', name }, 201);
    });

    const listServersRoute = createRoute({
        method: 'get',
        path: '/mcp/servers',
        tags: ['mcp'],
        responses: {
            200: {
                description: 'Servers list',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['mcp'],
        request: { params: z.object({ serverId: z.string() }) },
        responses: {
            200: {
                description: 'Tools list',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['mcp'],
        request: { params: z.object({ serverId: z.string() }) },
        responses: {
            200: {
                description: 'Disconnected',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['mcp'],
        request: { params: z.object({ serverId: z.string() }) },
        responses: {
            200: {
                description: 'Server restarted',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['mcp'],
        request: {
            params: z.object({ serverId: z.string(), toolName: z.string() }),
            body: { content: { 'application/json': { schema: ExecuteToolBodySchema } } },
        },
        responses: {
            200: {
                description: 'Tool executed',
                content: { 'application/json': { schema: z.any() } },
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
        const rawResult = await agent.executeTool(toolName, body);
        return ctx.json({ success: true, data: rawResult });
    });

    const listResourcesRoute = createRoute({
        method: 'get',
        path: '/mcp/servers/{serverId}/resources',
        tags: ['mcp'],
        request: { params: z.object({ serverId: z.string() }) },
        responses: {
            200: {
                description: 'Server resources',
                content: { 'application/json': { schema: z.any() } },
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
        tags: ['mcp'],
        request: {
            params: z.object({
                serverId: z.string(),
                resourceId: z
                    .string()
                    .min(1, 'Resource ID is required')
                    .transform((encoded) => decodeURIComponent(encoded)),
            }),
        },
        responses: {
            200: {
                description: 'Resource content',
                content: { 'application/json': { schema: z.any() } },
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
