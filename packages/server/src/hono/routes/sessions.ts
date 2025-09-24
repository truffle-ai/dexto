import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
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
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/sessions',
        tags: ['sessions'],
        responses: {
            200: {
                description: 'List sessions',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(listRoute, async (ctx: any) => {
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

    const createRouteDef = createRoute({
        method: 'post',
        path: '/sessions',
        tags: ['sessions'],
        request: { body: { content: { 'application/json': { schema: CreateSessionSchema } } } },
        responses: {
            201: {
                description: 'Session created',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(createRouteDef, async (ctx: any) => {
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

    const currentRoute = createRoute({
        method: 'get',
        path: '/sessions/current',
        tags: ['sessions'],
        responses: {
            200: {
                description: 'Current session',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(currentRoute, (ctx: any) => {
        const currentSessionId = agent.getCurrentSessionId();
        return sendJson(ctx, { currentSessionId });
    });

    const getRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string() }) },
        responses: {
            200: {
                description: 'Session details',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(getRoute, async (ctx: any) => {
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

    const historyRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}/history',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string() }) },
        responses: {
            200: {
                description: 'Session history',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(historyRoute, async (ctx: any) => {
        const { sessionId } = ctx.req.param();
        const history = await agent.getSessionHistory(sessionId);
        return sendJson(ctx, { history });
    });

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/sessions/{sessionId}',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string() }) },
        responses: {
            200: {
                description: 'Session deleted',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(deleteRoute, async (ctx: any) => {
        const { sessionId } = ctx.req.param();
        await agent.deleteSession(sessionId);
        return sendJson(ctx, { status: 'deleted', sessionId });
    });

    const cancelRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/cancel',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string() }) },
        responses: {
            200: {
                description: 'Cancel in-flight run',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(cancelRoute, async (ctx: any) => {
        const { sessionId } = parseParam(ctx, CancelSessionParams);
        const cancelled = await agent.cancel(sessionId);
        if (!cancelled) {
            logger.debug(`No in-flight run to cancel for session: ${sessionId}`);
        }
        return sendJson(ctx, { cancelled, sessionId });
    });

    const loadRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/load',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string() }),
            body: { content: { 'application/json': { schema: z.object({}).passthrough() } } },
        },
        responses: {
            200: {
                description: 'Session loaded/reset',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(loadRoute, async (ctx: any) => {
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
