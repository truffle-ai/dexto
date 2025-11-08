import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import { SessionMetadataSchema, InternalMessageSchema } from '../schemas/responses.js';

const CreateSessionSchema = z
    .object({
        sessionId: z.string().optional().describe('A custom ID for the new session'),
    })
    .describe('Request body for creating a new session');

export function createSessionsRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const SessionsQuerySchema = z
        .object({
            type: z.string().optional().describe('Filter by session type'),
            parentSessionId: z.string().optional().describe('Filter by parent session ID'),
            depth: z.coerce.number().int().nonnegative().optional().describe('Filter by depth'),
            lifecycle: z
                .enum(['ephemeral', 'persistent'])
                .optional()
                .describe('Filter by lifecycle policy'),
        })
        .describe('Query parameters for filtering sessions by scope criteria');
    type SessionQueryFilters = {
        type?: string;
        parentSessionId?: string;
        depth?: number;
        lifecycle?: 'ephemeral' | 'persistent';
    };

    const listRoute = createRoute({
        method: 'get',
        path: '/sessions',
        summary: 'List Sessions',
        description: 'Retrieves a list of active sessions, optionally filtered by scope criteria',
        tags: ['sessions'],
        request: {
            query: SessionsQuerySchema,
        },
        responses: {
            200: {
                description: 'List of sessions matching filters',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                sessions: z
                                    .array(SessionMetadataSchema)
                                    .describe('Array of session metadata objects'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });
    app.openapi(listRoute, async (ctx) => {
        const agent = getAgent();
        const query = ctx.req.valid('query');

        // Build filters from query params, only include defined values
        const filters: SessionQueryFilters = {};
        if (query.type) filters.type = query.type;
        if (query.parentSessionId) filters.parentSessionId = query.parentSessionId;
        if (query.depth !== undefined) filters.depth = query.depth;
        if (query.lifecycle) filters.lifecycle = query.lifecycle;

        // Pass filters to listSessions
        const sessionIds = await agent.listSessions(
            Object.keys(filters).length > 0 ? filters : undefined
        );

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
                        scopes: metadata?.scopes || {
                            type: 'primary' as const,
                            depth: 0,
                            lifecycle: 'persistent' as const,
                        },
                        metadata: metadata?.metadata,
                    };
                } catch {
                    // Skip sessions that no longer exist
                    return {
                        id,
                        createdAt: null,
                        lastActivity: null,
                        messageCount: 0,
                        title: null,
                        scopes: {
                            type: 'primary' as const,
                            depth: 0,
                            lifecycle: 'persistent' as const,
                        },
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
                description: 'Session created successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                session: SessionMetadataSchema.describe(
                                    'Newly created session metadata'
                                ),
                            })
                            .strict(),
                    },
                },
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
                    scopes: metadata?.scopes || {
                        type: 'primary' as const,
                        depth: 0,
                        lifecycle: 'persistent' as const,
                    },
                    metadata: metadata?.metadata,
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
                description: 'Current active session ID',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                currentSessionId: z
                                    .string()
                                    .nullable()
                                    .describe('ID of the current session, or null if none'),
                            })
                            .strict(),
                    },
                },
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
                description: 'Session details with metadata',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                session: SessionMetadataSchema.extend({
                                    history: z
                                        .number()
                                        .int()
                                        .nonnegative()
                                        .describe('Number of messages in history'),
                                })
                                    .strict()
                                    .describe('Session metadata with history count'),
                            })
                            .strict(),
                    },
                },
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
                scopes: metadata?.scopes || {
                    type: 'primary' as const,
                    depth: 0,
                    lifecycle: 'persistent' as const,
                },
                metadata: metadata?.metadata,
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
                description: 'Session conversation history',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                history: z
                                    .array(InternalMessageSchema)
                                    .describe('Array of messages in conversation history'),
                            })
                            .strict(),
                    },
                },
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
                description: 'Session deleted successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                status: z.literal('deleted').describe('Deletion status'),
                                sessionId: z.string().describe('ID of the deleted session'),
                            })
                            .strict(),
                    },
                },
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
                description: 'Cancel operation result',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                cancelled: z.boolean().describe('Whether a run was cancelled'),
                                sessionId: z.string().describe('Session ID'),
                            })
                            .strict(),
                    },
                },
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
            body: {
                content: { 'application/json': { schema: z.object({}).strict().optional() } },
            },
        },
        responses: {
            200: {
                description: 'Session loaded or reset successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                status: z.enum(['loaded', 'reset']).describe('Operation status'),
                                sessionId: z
                                    .string()
                                    .nullable()
                                    .describe('Loaded session ID or null if reset'),
                                currentSession: z
                                    .string()
                                    .nullable()
                                    .describe('Current active session ID'),
                            })
                            .strict(),
                    },
                },
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
                description: 'Session updated successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                session: SessionMetadataSchema.describe('Updated session metadata'),
                            })
                            .strict(),
                    },
                },
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
                scopes: metadata?.scopes || {
                    type: 'primary' as const,
                    depth: 0,
                    lifecycle: 'persistent' as const,
                },
                metadata: metadata?.metadata,
            },
        });
    });

    return app;
}
