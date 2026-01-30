import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { MessageSearchResponseSchema, SessionSearchResponseSchema } from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const MessageSearchQuery = z.object({
    q: z.string().min(1, 'Search query is required').describe('Search query string'),
    limit: z.coerce
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of results to return (default: 20)'),
    offset: z.coerce
        .number()
        .min(0)
        .optional()
        .describe('Number of results to skip for pagination (default: 0)'),
    sessionId: z.string().optional().describe('Limit search to a specific session'),
    role: z
        .enum(['user', 'assistant', 'system', 'tool'])
        .optional()
        .describe('Filter by message role'),
});

const SessionSearchQuery = z.object({
    q: z.string().min(1, 'Search query is required').describe('Search query string'),
});

export function createSearchRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const messagesRoute = createRoute({
        method: 'get',
        path: '/search/messages',
        summary: 'Search Messages',
        description: 'Searches for messages across all sessions or within a specific session',
        tags: ['search'],
        request: { query: MessageSearchQuery },
        responses: {
            200: {
                description: 'Message search results',
                content: { 'application/json': { schema: MessageSearchResponseSchema } },
            },
        },
    });

    const sessionsRoute = createRoute({
        method: 'get',
        path: '/search/sessions',
        summary: 'Search Sessions',
        description: 'Searches for sessions that contain the specified query',
        tags: ['search'],
        request: { query: SessionSearchQuery },
        responses: {
            200: {
                description: 'Session search results',
                content: { 'application/json': { schema: SessionSearchResponseSchema } },
            },
        },
    });

    return app
        .openapi(messagesRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { q, limit, offset, sessionId, role } = ctx.req.valid('query');
            const options = {
                limit: limit || 20,
                offset: offset || 0,
                ...(sessionId && { sessionId }),
                ...(role && { role }),
            };

            const searchResults = await agent.searchMessages(q, options);
            // TODO: Improve type alignment between core and server schemas.
            // Core's InternalMessage has union types for binary data, but JSON responses are strings.
            return ctx.json(searchResults as z.output<typeof MessageSearchResponseSchema>);
        })
        .openapi(sessionsRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { q } = ctx.req.valid('query');
            const searchResults = await agent.searchSessions(q);
            // TODO: Improve type alignment between core and server schemas.
            return ctx.json(searchResults as z.output<typeof SessionSearchResponseSchema>);
        });
}
