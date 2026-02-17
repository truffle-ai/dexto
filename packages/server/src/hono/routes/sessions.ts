import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { SessionMetadataSchema, InternalMessageSchema } from '../schemas/responses.js';
import type { GetAgentFn } from '../index.js';

const CreateSessionSchema = z
    .object({
        sessionId: z.string().optional().describe('A custom ID for the new session'),
    })
    .describe('Request body for creating a new session');

export function createSessionsRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/sessions',
        summary: 'List Sessions',
        description: 'Retrieves a list of all active sessions',
        tags: ['sessions'],
        responses: {
            200: {
                description: 'List of all active sessions',
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

    const historyRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}/history',
        summary: 'Get Session History',
        description:
            'Retrieves the conversation history for a session along with processing status',
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
                                isBusy: z
                                    .boolean()
                                    .describe(
                                        'Whether the session is currently processing a message'
                                    ),
                            })
                            .strict(),
                    },
                },
            },
        },
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

    const cancelRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/cancel',
        summary: 'Cancel Session Run',
        description:
            'Cancels an in-flight agent run for the specified session. ' +
            'By default (soft cancel), only the current LLM call is cancelled and queued messages continue processing. ' +
            'Set clearQueue=true for hard cancel to also clear any queued messages.',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string().describe('Session identifier') }),
            body: {
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                clearQueue: z
                                    .boolean()
                                    .optional()
                                    .default(false)
                                    .describe(
                                        'If true (hard cancel), clears queued messages. If false (soft cancel, default), queued messages continue processing.'
                                    ),
                            })
                            .strict(),
                    },
                },
                required: false,
            },
        },
        responses: {
            200: {
                description: 'Cancel operation result',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                cancelled: z.boolean().describe('Whether a run was cancelled'),
                                sessionId: z.string().describe('Session ID'),
                                queueCleared: z
                                    .boolean()
                                    .describe('Whether queued messages were cleared'),
                                clearedCount: z
                                    .number()
                                    .describe(
                                        'Number of queued messages cleared (0 if soft cancel)'
                                    ),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const loadRoute = createRoute({
        method: 'get',
        path: '/sessions/{sessionId}/load',
        summary: 'Load Session',
        description:
            'Validates and retrieves session information including processing status. The client should track the active session.',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string().describe('Session identifier') }),
        },
        responses: {
            200: {
                description: 'Session information retrieved successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                session: SessionMetadataSchema.extend({
                                    isBusy: z
                                        .boolean()
                                        .describe(
                                            'Whether the session is currently processing a message'
                                        ),
                                }).describe('Session metadata with processing status'),
                            })
                            .strict(),
                    },
                },
            },
            404: {
                description: 'Session not found',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                error: z.string().describe('Error message'),
                            })
                            .strict(),
                    },
                },
            },
        },
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

    const generateTitleRoute = createRoute({
        method: 'post',
        path: '/sessions/{sessionId}/generate-title',
        summary: 'Generate Session Title',
        description:
            'Generates a descriptive title for the session using the first user message. Returns existing title if already set.',
        tags: ['sessions'],
        request: {
            params: z.object({ sessionId: z.string().describe('Session identifier') }),
        },
        responses: {
            200: {
                description: 'Title generated successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                title: z
                                    .string()
                                    .nullable()
                                    .describe('Generated title, or null if generation failed'),
                                sessionId: z.string().describe('Session ID'),
                            })
                            .strict(),
                    },
                },
            },
            404: {
                description: 'Session not found (error format handled by middleware)',
            },
        },
    });

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
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
                            workspaceId: metadata?.workspaceId || null,
                        };
                    } catch {
                        // Skip sessions that no longer exist
                        return {
                            id,
                            createdAt: null,
                            lastActivity: null,
                            messageCount: 0,
                            title: null,
                            workspaceId: null,
                        };
                    }
                })
            );
            return ctx.json({ sessions });
        })
        .openapi(createRouteDef, async (ctx) => {
            const agent = await getAgent(ctx);
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
                        workspaceId: metadata?.workspaceId || null,
                    },
                },
                201
            );
        })
        .openapi(getRoute, async (ctx) => {
            const agent = await getAgent(ctx);
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
                    workspaceId: metadata?.workspaceId || null,
                    history: history.length,
                },
            });
        })
        .openapi(historyRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.param();
            const [history, isBusy] = await Promise.all([
                agent.getSessionHistory(sessionId),
                agent.isSessionBusy(sessionId),
            ]);
            // TODO: Improve type alignment between core and server schemas.
            // Core's InternalMessage has union types (string | Uint8Array | Buffer | URL)
            // for binary data, but JSON responses are always base64 strings.
            return ctx.json({
                history: history as z.output<typeof InternalMessageSchema>[],
                isBusy,
            });
        })
        .openapi(deleteRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.param();
            await agent.deleteSession(sessionId);
            return ctx.json({ status: 'deleted', sessionId });
        })
        .openapi(cancelRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            // Get clearQueue from body, default to false (soft cancel)
            let clearQueue = false;
            try {
                const body = ctx.req.valid('json');
                clearQueue = body?.clearQueue ?? false;
            } catch {
                // No body or invalid body - use default (soft cancel)
            }

            // If hard cancel, clear the queue first
            let clearedCount = 0;
            if (clearQueue) {
                try {
                    clearedCount = await agent.clearMessageQueue(sessionId);
                    agent.logger.debug(
                        `Hard cancel: cleared ${clearedCount} queued message(s) for session: ${sessionId}`
                    );
                } catch {
                    // Session might not exist or queue not accessible - continue with cancel
                }
            }

            // Then cancel the current run
            const cancelled = await agent.cancel(sessionId);
            if (!cancelled) {
                agent.logger.debug(`No in-flight run to cancel for session: ${sessionId}`);
            }

            return ctx.json({
                cancelled,
                sessionId,
                queueCleared: clearQueue,
                clearedCount,
            });
        })
        .openapi(loadRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            // Validate that session exists
            const sessionIds = await agent.listSessions();
            if (!sessionIds.includes(sessionId)) {
                return ctx.json({ error: `Session not found: ${sessionId}` }, 404);
            }

            // Return session metadata with processing status
            const metadata = await agent.getSessionMetadata(sessionId);
            const isBusy = await agent.isSessionBusy(sessionId);
            return ctx.json(
                {
                    session: {
                        id: sessionId,
                        createdAt: metadata?.createdAt || null,
                        lastActivity: metadata?.lastActivity || null,
                        messageCount: metadata?.messageCount || 0,
                        title: metadata?.title || null,
                        workspaceId: metadata?.workspaceId || null,
                        isBusy,
                    },
                },
                200
            );
        })
        .openapi(patchRoute, async (ctx) => {
            const agent = await getAgent(ctx);
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
                    workspaceId: metadata?.workspaceId || null,
                },
            });
        })
        .openapi(generateTitleRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const title = await agent.generateSessionTitle(sessionId);
            return ctx.json({ title, sessionId });
        });
}
