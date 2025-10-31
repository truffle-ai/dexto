import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';

const CreateSessionSchema = z.object({
    sessionId: z.string().optional().describe('A custom ID for the new session'),
});

export function createSessionsRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/sessions',
        summary: 'List Sessions',
        description: 'Retrieves a list of all active sessions',
        tags: ['sessions'],
        responses: {
            200: {
                description: 'List sessions',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(listRoute, async (ctx) => {
        const agent = getAgent();
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
                        title: metadata?.title || null,
                    };
                } catch {
                    // Skip sessions that no longer exist
                    return {
                        id,
                        createdAt: null,
                        lastActivity: null,
                        messageCount: 0,
                        title: null,
                    };
                }
            })
        );
        return ctx.json({ sessions });
    });

    const createRouteDef = createRoute({
        method: 'post',
        path: '/sessions',
        summary: 'Create Session',
        description: 'Creates a new session',
        tags: ['sessions'],
        request: { body: { content: { 'application/json': { schema: CreateSessionSchema } } } },
        responses: {
            201: {
                description: 'Session created',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(createRouteDef, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('json');
        const session = await agent.createSession(sessionId);
        const metadata = await agent.getSessionMetadata(session.id);
        return ctx.json(
            {
                session: {
                    id: session.id,
                    createdAt: metadata?.createdAt || Date.now(),
                    lastActivity: metadata?.lastActivity || Date.now(),
                    messageCount: metadata?.messageCount || 0,
                    title: metadata?.title || null,
                },
            },
            201
        );
    });

    const currentRoute = createRoute({
        method: 'get',
        path: '/sessions/current',
        summary: 'Get Current Session',
        description: 'Retrieves the ID of the currently active session',
        tags: ['sessions'],
        responses: {
            200: {
                description: 'Current session',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(currentRoute, (ctx) => {
        const agent = getAgent();
        const currentSessionId = agent.getCurrentSessionId();
        return ctx.json({ currentSessionId });
    });

    const getRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}',
        summary: 'Get Session Details',
        description: 'Fetches details for a specific session',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string().describe('Session identifier') }) },
        responses: {
            200: {
                description: 'Session details',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(getRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.param();
        const metadata = await agent.getSessionMetadata(sessionId);
        const history = await agent.getSessionHistory(sessionId);
        return ctx.json({
            session: {
                id: sessionId,
                createdAt: metadata?.createdAt || null,
                lastActivity: metadata?.lastActivity || null,
                messageCount: metadata?.messageCount || 0,
                title: metadata?.title || null,
                history: history.length,
            },
        });
    });

    const historyRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}/history',
        summary: 'Get Session History',
        description: 'Retrieves the conversation history for a session',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string().describe('Session identifier') }) },
        responses: {
            200: {
                description: 'Session history',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(historyRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.param();
        const history = await agent.getSessionHistory(sessionId);
        return ctx.json({ history });
    });

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/sessions/{sessionId}',
        summary: 'Delete Session',
        description:
            'Permanently deletes a session and all its conversation history. This action cannot be undone',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string().describe('Session identifier') }) },
        responses: {
            200: {
                description: 'Session deleted',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(deleteRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.param();
        await agent.deleteSession(sessionId);
        return ctx.json({ status: 'deleted', sessionId });
    });

    const cancelRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/cancel',
        summary: 'Cancel Session Run',
        description: 'Cancels an in-flight agent run for the specified session',
        tags: ['sessions'],
        request: { params: z.object({ sessionId: z.string().describe('Session identifier') }) },
        responses: {
            200: {
                description: 'Cancel in-flight run',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(cancelRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('param');
        const cancelled = await agent.cancel(sessionId);
        if (!cancelled) {
            logger.debug(`No in-flight run to cancel for session: ${sessionId}`);
        }
        return ctx.json({ cancelled, sessionId });
    });

    const loadRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/load',
        summary: 'Load Session',
        description: 'Sets a session as the current active session',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string().describe('Session identifier') }),
            body: { content: { 'application/json': { schema: z.object({}).passthrough() } } },
        },
        responses: {
            200: {
                description: 'Session loaded/reset',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(loadRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('param');
        if (sessionId === 'null' || sessionId === 'undefined') {
            await agent.loadSessionAsDefault(null);
            return ctx.json({
                status: 'reset',
                sessionId: null,
                currentSession: agent.getCurrentSessionId(),
            });
        }

        await agent.loadSessionAsDefault(sessionId);
        return ctx.json({
            status: 'loaded',
            sessionId,
            currentSession: agent.getCurrentSessionId(),
        });
    });

    const patchRoute = createRoute({
        method: 'patch',
        path: '/sessions/{sessionId}',
        summary: 'Update Session Title',
        description: 'Updates the title of an existing session',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string().describe('Session identifier') }),
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            title: z
                                .string()
                                .min(1, 'Title is required')
                                .max(120, 'Title too long')
                                .describe('New title for the session (maximum 120 characters)'),
                        }),
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Session updated',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(patchRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('param');
        const { title } = ctx.req.valid('json');
        await agent.setSessionTitle(sessionId, title);
        const metadata = await agent.getSessionMetadata(sessionId);
        return ctx.json({
            session: {
                id: sessionId,
                createdAt: metadata?.createdAt || null,
                lastActivity: metadata?.lastActivity || null,
                messageCount: metadata?.messageCount || 0,
                title: metadata?.title || title,
            },
        });
    });

    return app;
}
