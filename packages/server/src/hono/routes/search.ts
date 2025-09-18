import { Hono } from 'hono';
import { z } from 'zod';
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
    const app = new Hono();

    app.get('/search/messages', async (ctx) => {
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

    app.get('/search/sessions', async (ctx) => {
        const { q } = parseQuery(ctx, SessionSearchQuery);
        const searchResults = await agent.searchSessions(q);
        return sendJson(ctx, searchResults);
    });

    return app;
}
