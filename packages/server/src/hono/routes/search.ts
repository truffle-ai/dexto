import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';

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

export function createSearchRouter(getAgent: () => DextoAgent) {
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
        const agent = getAgent();
        const { q, limit, offset, sessionId, role } = ctx.req.valid('query');
        const options = {
            limit: limit || 20,
            offset: offset || 0,
            ...(sessionId && { sessionId }),
            ...(role && { role }),
        };

        const searchResults = await agent.searchMessages(q, options);
        return ctx.json(searchResults);
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
        const agent = getAgent();
        const { q } = ctx.req.valid('query');
        const searchResults = await agent.searchSessions(q);
        return ctx.json(searchResults);
    });

    return app;
}
