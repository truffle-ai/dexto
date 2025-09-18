import { Hono } from 'hono';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import { sendJson } from '../utils/response.js';
import { parseJson, parseParam } from '../utils/validation.js';

const CreateSessionSchema = z.object({
    sessionId: z.string().optional(),
});

const LoadSessionParams = z.object({
    sessionId: z.string(),
});

const CancelSessionParams = z.object({
    sessionId: z.string(),
});

export function createSessionsRouter(agent: DextoAgent) {
    const app = new Hono();

    app.get('/sessions', async (ctx) => {
        const sessionIds = await agent.listSessions();
        const sessions = await Promise.all(
            sessionIds.map(async (id) => {
                try {
                    const metadata = await agent.getSessionMetadata(id);
                    return {
                        id,
                        createdAt: metadata?.createdAt || null,
                        lastActivity: metadata?.lastActivity || null,
                        messageCount: metadata?.messageCount || 0,
                    };
                } catch {
                    return {
                        id,
                        createdAt: null,
                        lastActivity: null,
                        messageCount: 0,
                    };
                }
            })
        );
        return sendJson(ctx, { sessions });
    });

    app.post('/sessions', async (ctx) => {
        const { sessionId } = await parseJson(ctx, CreateSessionSchema);
        const session = await agent.createSession(sessionId);
        const metadata = await agent.getSessionMetadata(session.id);
        return sendJson(
            ctx,
            {
                session: {
                    id: session.id,
                    createdAt: metadata?.createdAt || Date.now(),
                    lastActivity: metadata?.lastActivity || Date.now(),
                    messageCount: metadata?.messageCount || 0,
                },
            },
            201
        );
    });

    app.get('/sessions/current', (ctx) => {
        const currentSessionId = agent.getCurrentSessionId();
        return sendJson(ctx, { currentSessionId });
    });

    app.get('/sessions/:sessionId', async (ctx) => {
        const { sessionId } = ctx.req.param();
        const metadata = await agent.getSessionMetadata(sessionId);
        const history = await agent.getSessionHistory(sessionId);
        return sendJson(ctx, {
            session: {
                id: sessionId,
                createdAt: metadata?.createdAt || null,
                lastActivity: metadata?.lastActivity || null,
                messageCount: metadata?.messageCount || 0,
                history: history.length,
            },
        });
    });

    app.get('/sessions/:sessionId/history', async (ctx) => {
        const { sessionId } = ctx.req.param();
        const history = await agent.getSessionHistory(sessionId);
        return sendJson(ctx, { history });
    });

    app.delete('/sessions/:sessionId', async (ctx) => {
        const { sessionId } = ctx.req.param();
        await agent.deleteSession(sessionId);
        return sendJson(ctx, { status: 'deleted', sessionId });
    });

    app.post('/sessions/:sessionId/cancel', async (ctx) => {
        const { sessionId } = parseParam(ctx, CancelSessionParams);
        const cancelled = await agent.cancel(sessionId);
        if (!cancelled) {
            logger.debug(`No in-flight run to cancel for session: ${sessionId}`);
        }
        return sendJson(ctx, { cancelled, sessionId });
    });

    app.post('/sessions/:sessionId/load', async (ctx) => {
        const { sessionId } = parseParam(ctx, LoadSessionParams);
        if (sessionId === 'null' || sessionId === 'undefined') {
            await agent.loadSessionAsDefault(null);
            return sendJson(ctx, {
                status: 'reset',
                sessionId: null,
                currentSession: agent.getCurrentSessionId(),
            });
        }

        await agent.loadSessionAsDefault(sessionId);
        return sendJson(ctx, {
            status: 'loaded',
            sessionId,
            currentSession: agent.getCurrentSessionId(),
        });
    });

    return app;
}
