import { Hono } from 'hono';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { logger, McpServerConfigSchema } from '@dexto/core';
import { sendJson } from '../utils/response.js';
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
    const app = new Hono();

    app.post('/connect-server', async (ctx) => {
        const { name, config } = await parseJson(ctx, ConnectServerSchema);
        await agent.connectMcpServer(name, config);
        logger.info(`Successfully connected to new server '${name}' via API request.`);
        return sendJson(ctx, { status: 'connected', name });
    });

    app.post('/mcp/servers', async (ctx) => {
        const { name, config } = await parseJson(ctx, ConnectServerSchema);
        await agent.connectMcpServer(name, config);
        return sendJson(ctx, { status: 'connected', name }, 201);
    });

    app.get('/mcp/servers', async (ctx) => {
        const clientsMap = agent.getMcpClients();
        const failedConnections = agent.getMcpFailedConnections();
        const servers: Array<{ id: string; name: string; status: string }> = [];
        for (const name of clientsMap.keys()) {
            servers.push({ id: name, name, status: 'connected' });
        }
        for (const name of Object.keys(failedConnections)) {
            servers.push({ id: name, name, status: 'error' });
        }
        return sendJson(ctx, { servers });
    });

    app.get('/mcp/servers/:serverId/tools', async (ctx) => {
        const { serverId } = parseParam(ctx, ServerParamSchema);
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return sendJson(ctx, { error: `Server '${serverId}' not found` }, 404);
        }
        const toolsMap = await client.getTools();
        const tools = Object.entries(toolsMap).map(([toolName, toolDef]) => ({
            id: toolName,
            name: toolName,
            description: toolDef.description || '',
            inputSchema: toolDef.parameters,
        }));
        return sendJson(ctx, { tools });
    });

    app.delete('/mcp/servers/:serverId', async (ctx) => {
        const { serverId } = parseParam(ctx, ServerParamSchema);
        const clientExists =
            agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
        if (!clientExists) {
            return sendJson(ctx, { error: `Server '${serverId}' not found.` }, 404);
        }

        await agent.removeMcpServer(serverId);
        return sendJson(ctx, { status: 'disconnected', id: serverId });
    });

    app.post('/mcp/servers/:serverId/tools/:toolName/execute', async (ctx) => {
        const { serverId, toolName } = parseParam(ctx, ExecuteToolParams);
        const body = ExecuteToolBodySchema.parse(await ctx.req.json());
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return sendJson(ctx, { success: false, error: `Server '${serverId}' not found` }, 404);
        }
        const rawResult = await agent.executeTool(toolName, body);
        return sendJson(ctx, { success: true, data: rawResult });
    });

    return app;
}
