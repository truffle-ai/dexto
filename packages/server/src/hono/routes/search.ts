import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { sendJson } from '../utils/response.js';
import { parseQuery } from '../utils/validation.js';

const MessageSearchQuery = z.object({
    q: z.string().min(1, 'Search query is required'),
    limit: z.coerce.number().min(1).max(100).optional(),
    offset: z.coerce.number().min(0).optional(),
    sessionId: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    pretty: z.string().optional(),
});

const SessionSearchQuery = z.object({
    q: z.string().min(1, 'Search query is required'),
    pretty: z.string().optional(),
});

export function createSearchRouter(agent: DextoAgent) {
    const app = new OpenAPIHono();

    const messagesRoute = createRoute({
        method: 'get',
        path: '/search/messages',
        tags: ['search'],
        request: { query: MessageSearchQuery },
        responses: {
            200: {
                description: 'Message search results',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(messagesRoute, async (ctx) => {
        const { q, limit, offset, sessionId, role } = parseQuery(ctx, MessageSearchQuery);
        const options = {
            limit: limit || 20,
            offset: offset || 0,
            ...(sessionId && { sessionId }),
            ...(role && { role }),
        };

        const searchResults = await agent.searchMessages(q, options);
        return sendJson(ctx, searchResults);
    });

    const sessionsRoute = createRoute({
        method: 'get',
        path: '/search/sessions',
        tags: ['search'],
        request: { query: SessionSearchQuery },
        responses: {
            200: {
                description: 'Session search results',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(sessionsRoute, async (ctx) => {
        const { q } = parseQuery(ctx, SessionSearchQuery);
        const searchResults = await agent.searchSessions(q);
        return sendJson(ctx, searchResults);
    });

    return app;
}
