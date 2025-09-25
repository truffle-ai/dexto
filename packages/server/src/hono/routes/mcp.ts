import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger, McpServerConfigSchema } from '@dexto/core';
import { parseJson, parseParam } from '../utils/validation.js';

const ConnectServerSchema = z.object({
    name: z.string().min(1, 'Server name is required'),
    config: McpServerConfigSchema,
});

const ServerParamSchema = z.object({
    serverId: z.string(),
});

const ExecuteToolParams = z.object({
    serverId: z.string(),
    toolName: z.string(),
});

const ExecuteToolBodySchema = z.any(); // TODO: tighten schema once tool input structure is standardised.

export function createMcpRouter(agent: DextoAgent) {
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
        const { name, config } = await parseJson(ctx, ConnectServerSchema);
        await agent.connectMcpServer(name, config);
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
        const { name, config } = await parseJson(ctx, ConnectServerSchema);
        await agent.connectMcpServer(name, config);
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
        const { serverId } = parseParam(ctx, ServerParamSchema);
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
        const { serverId } = parseParam(ctx, ServerParamSchema);
        const clientExists =
            agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
        if (!clientExists) {
            return ctx.json({ error: `Server '${serverId}' not found.` }, 404);
        }

        await agent.removeMcpServer(serverId);
        return ctx.json({ status: 'disconnected', id: serverId });
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
        const { serverId, toolName } = parseParam(ctx, ExecuteToolParams);
        const body = ExecuteToolBodySchema.parse(await ctx.req.json());
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return ctx.json({ success: false, error: `Server '${serverId}' not found` }, 404);
        }
        const rawResult = await agent.executeTool(toolName, body);
        return ctx.json({ success: true, data: rawResult });
    });

    return app;
}
