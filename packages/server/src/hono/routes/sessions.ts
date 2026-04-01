import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
    DextoRuntimeError,
    ErrorScope,
    ErrorType,
    zodToIssues,
    type ContentPart as CoreContentPart,
    type InternalMessage as CoreInternalMessage,
    type SessionMetadata as CoreSessionMetadata,
} from '@dexto/core';
import {
    BadRequestErrorResponse,
    ConflictErrorResponse,
    InternalErrorResponse,
    SessionMetadataSchema,
    InternalMessageSchema,
    NotFoundErrorResponse,
    ScopedUsageSummarySchema,
    UsageSummarySchema,
    toApiInternalMessage,
} from '../schemas/responses.js';
import { handleHonoError } from '../middleware/error.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';

const CreateSessionSchema = z
    .object({
        sessionId: z.string().optional().describe('A custom ID for the new session'),
    })
    .describe('Request body for creating a new session');

const MAX_SYSTEM_PROMPT_CONTRIBUTOR_CONTENT_CHARS = 120000;
const DEFAULT_SYSTEM_PROMPT_CONTRIBUTOR_PRIORITY = 45;

const SessionPromptContributorInfoSchema = z
    .object({
        id: z.string().describe('Contributor identifier'),
        priority: z.number().describe('Contributor priority'),
    })
    .strict()
    .describe('Session-scoped system prompt contributor metadata.');

const UpsertSessionPromptContributorSchema = z
    .object({
        id: z.string().min(1).describe('Contributor identifier'),
        priority: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .default(DEFAULT_SYSTEM_PROMPT_CONTRIBUTOR_PRIORITY)
            .describe('Optional priority override'),
        enabled: z
            .boolean()
            .default(true)
            .describe('Set false to remove the contributor instead of adding or updating it'),
        content: z
            .string()
            .optional()
            .describe('Static contributor content for this session (required when enabled)'),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.enabled !== false && (!value.content || value.content.trim().length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['content'],
                message: 'Contributor content is required when enabled',
            });
        }
    })
    .describe('Session-scoped system prompt contributor update payload.');

function sanitizeContributorId(value: string): string {
    return value
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function mapSessionMetadata(
    sessionId: string,
    metadata: CoreSessionMetadata | undefined,
    defaults?: {
        createdAt?: number | null;
        lastActivity?: number | null;
        messageCount?: number;
        title?: string | null;
        workspaceId?: string | null;
        parentSessionId?: string | null;
    }
) {
    return {
        id: sessionId,
        createdAt: metadata?.createdAt ?? defaults?.createdAt ?? null,
        lastActivity: metadata?.lastActivity ?? defaults?.lastActivity ?? null,
        messageCount: metadata?.messageCount ?? defaults?.messageCount ?? 0,
        title: metadata?.title ?? defaults?.title ?? null,
        ...(metadata?.tokenUsage && { tokenUsage: metadata.tokenUsage }),
        ...(metadata?.estimatedCost !== undefined && {
            estimatedCost: metadata.estimatedCost,
        }),
        ...(metadata?.modelStats && { modelStats: metadata.modelStats }),
        ...(metadata?.usageTracking && { usageTracking: metadata.usageTracking }),
        workspaceId: metadata?.workspaceId ?? defaults?.workspaceId ?? null,
        parentSessionId: metadata?.parentSessionId ?? defaults?.parentSessionId ?? null,
    };
}

async function expandBlobHistoryContentForApi(
    content: CoreContentPart[],
    agent: Awaited<ReturnType<GetAgentFn>>
): Promise<CoreContentPart[]> {
    const expanded: CoreContentPart[] = [];

    for (const part of content) {
        if (
            part.type === 'image' &&
            typeof part.image === 'string' &&
            part.image.startsWith('@blob:')
        ) {
            try {
                const result = await agent.resourceManager.read(part.image.slice(1));
                let resolved = false;
                for (const item of result.contents) {
                    if (typeof item !== 'object' || item === null || !('blob' in item)) {
                        continue;
                    }
                    if (typeof item.blob !== 'string') {
                        continue;
                    }

                    expanded.push({
                        type: 'image',
                        image: item.blob,
                        ...(typeof item.mimeType === 'string'
                            ? { mimeType: item.mimeType }
                            : part.mimeType !== undefined
                              ? { mimeType: part.mimeType }
                              : {}),
                    });
                    resolved = true;
                    break;
                }
                if (resolved) continue;
            } catch (error) {
                agent.logger.warn(
                    `Failed to expand image blob for session history: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (
            part.type === 'file' &&
            typeof part.data === 'string' &&
            part.data.startsWith('@blob:')
        ) {
            try {
                const result = await agent.resourceManager.read(part.data.slice(1));
                let resolved = false;
                for (const item of result.contents) {
                    if (typeof item !== 'object' || item === null || !('blob' in item)) {
                        continue;
                    }
                    if (typeof item.blob !== 'string') {
                        continue;
                    }

                    expanded.push({
                        type: 'file',
                        data: item.blob,
                        mimeType: typeof item.mimeType === 'string' ? item.mimeType : part.mimeType,
                        ...('filename' in item && typeof item.filename === 'string'
                            ? { filename: item.filename }
                            : part.filename !== undefined
                              ? { filename: part.filename }
                              : {}),
                    });
                    resolved = true;
                    break;
                }
                if (resolved) continue;
            } catch (error) {
                agent.logger.warn(
                    `Failed to expand file blob for session history: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        expanded.push(part);
    }

    return expanded;
}

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
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
    },
});

const forkRoute = createRoute({
    method: 'post',
    path: '/sessions/{sessionId}/fork',
    summary: 'Fork Session',
    description:
        'Creates a new child session by cloning the specified parent session history and metadata lineage.',
    tags: ['sessions'],
    request: {
        params: z.object({
            sessionId: z.string().describe('Parent session identifier'),
        }),
    },
    responses: {
        201: {
            description: 'Forked session created successfully',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            session: SessionMetadataSchema.describe(
                                'Newly created child session metadata'
                            ),
                        })
                        .strict(),
                },
            },
        },
        400: {
            ...BadRequestErrorResponse,
        },
        404: {
            ...NotFoundErrorResponse,
        },
        500: InternalErrorResponse,
    },
});

const historyRoute = createRoute({
    method: 'get',
    path: '/sessions/{sessionId}/history',
    summary: 'Get Session History',
    description: 'Retrieves the conversation history for a session along with processing status',
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
                                .describe('Whether the session is currently processing a message'),
                        })
                        .strict(),
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
    },
});

const listSessionPromptContributorsRoute = createRoute({
    method: 'get',
    path: '/sessions/{sessionId}/system-prompt/contributors',
    summary: 'List Session System Prompt Contributors',
    description:
        'Lists static system prompt contributors that apply only to the specified session.',
    tags: ['sessions', 'config'],
    request: { params: z.object({ sessionId: z.string().describe('Session identifier') }) },
    responses: {
        200: {
            description: 'Current session contributor list',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            contributors: z
                                .array(SessionPromptContributorInfoSchema)
                                .describe('Registered session prompt contributors.'),
                        })
                        .strict(),
                },
            },
        },
        404: {
            ...NotFoundErrorResponse,
        },
        500: InternalErrorResponse,
    },
});

const upsertSessionPromptContributorRoute = createRoute({
    method: 'post',
    path: '/sessions/{sessionId}/system-prompt/contributors',
    summary: 'Upsert Session System Prompt Contributor',
    description:
        'Adds or updates a static system prompt contributor that applies only to the specified session. Set enabled=false to remove it.',
    tags: ['sessions', 'config'],
    request: {
        params: z.object({ sessionId: z.string().describe('Session identifier') }),
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpsertSessionPromptContributorSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Session contributor upsert result',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            id: z.string().describe('Contributor identifier'),
                            enabled: z
                                .boolean()
                                .describe('Whether the contributor remains enabled'),
                            priority: z.number().optional().describe('Contributor priority'),
                            replaced: z
                                .boolean()
                                .optional()
                                .describe('Whether an existing contributor was replaced'),
                            removed: z
                                .boolean()
                                .optional()
                                .describe('Whether the contributor was removed'),
                            contentLength: z
                                .number()
                                .optional()
                                .describe('Stored content length in characters'),
                            truncated: z
                                .boolean()
                                .optional()
                                .describe('Whether the submitted content was truncated'),
                        })
                        .strict(),
                },
            },
        },
        400: {
            ...BadRequestErrorResponse,
        },
        404: {
            ...NotFoundErrorResponse,
        },
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
                                .describe('Number of queued messages cleared (0 if soft cancel)'),
                        })
                        .strict(),
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
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
                                usageSummary: UsageSummarySchema.describe(
                                    'Exact usage summary derived from assistant message history'
                                ),
                                activeUsageScopeId: z
                                    .string()
                                    .nullable()
                                    .describe(
                                        'Current runtime usage scope identifier, if configured'
                                    ),
                                activeUsageScope: ScopedUsageSummarySchema.nullable().describe(
                                    'Usage summary for the current runtime scope, if configured'
                                ),
                            }).describe('Session metadata with processing status'),
                        })
                        .strict(),
                },
            },
        },
        404: {
            ...NotFoundErrorResponse,
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const clearContextRoute = createRoute({
    method: 'post',
    path: '/sessions/{sessionId}/clear-context',
    summary: 'Clear Session Context',
    description:
        'Clears the model context window for a session while preserving conversation history for review.',
    tags: ['sessions'],
    request: {
        params: z.object({ sessionId: z.string().describe('Session identifier') }),
    },
    responses: {
        200: {
            description: 'Session context cleared successfully',
            content: {
                'application/json': {
                    schema: z
                        .object({
                            status: z.literal('context cleared').describe('Context clear status'),
                            sessionId: z.string().describe('Session ID'),
                        })
                        .strict(),
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        500: InternalErrorResponse,
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
            ...NotFoundErrorResponse,
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

export function createSessionsRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono({
        defaultHook: (result, ctx) => {
            if (!result.success) {
                const issues = zodToIssues(result.error);
                return handleHonoError(
                    ctx,
                    new DextoRuntimeError(
                        'validation_failed',
                        'validation',
                        ErrorType.USER,
                        issues[0]?.message ?? 'Validation failed',
                        { issues }
                    )
                );
            }
        },
    });
    app.onError((err, ctx) => handleHonoError(ctx, err));

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const sessionIds = await agent.listSessions();
            const sessions = await Promise.all(
                sessionIds.map(async (id) => {
                    try {
                        const metadata = await agent.getSessionMetadata(id);
                        return mapSessionMetadata(id, metadata);
                    } catch {
                        // Skip sessions that no longer exist
                        return mapSessionMetadata(id, undefined);
                    }
                })
            );
            return ctx.json({ sessions }, 200);
        })
        .openapi(createRouteDef, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('json');
            const session = await agent.createSession(sessionId);
            const metadata = await agent.getSessionMetadata(session.id);
            return ctx.json(
                {
                    session: mapSessionMetadata(session.id, metadata, {
                        createdAt: Date.now(),
                        lastActivity: Date.now(),
                    }),
                },
                201
            );
        })
        .openapi(forkRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId: parentSessionId } = ctx.req.valid('param');
            const session = await agent.forkSession(parentSessionId);
            const metadata = await agent.getSessionMetadata(session.id);
            return ctx.json(
                {
                    session: mapSessionMetadata(session.id, metadata),
                },
                201
            );
        })
        .openapi(getRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.param();
            const metadata = await agent.getSessionMetadata(sessionId);
            const history = await agent.getSessionHistory(sessionId);
            return ctx.json(
                {
                    session: {
                        ...mapSessionMetadata(sessionId, metadata),
                        history: history.length,
                    },
                },
                200
            );
        })
        .openapi(historyRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.param();
            const [history, isBusy] = await Promise.all([
                agent.getSessionHistory(sessionId, { expandBlobReferences: false }),
                agent.isSessionBusy(sessionId),
            ]);
            const expandedHistory: CoreInternalMessage[] = await Promise.all(
                history.map(async (message): Promise<CoreInternalMessage> => {
                    if (!Array.isArray(message.content)) {
                        return message;
                    }

                    return {
                        ...message,
                        content: await expandBlobHistoryContentForApi(message.content, agent),
                    } as CoreInternalMessage;
                })
            );
            // TODO: Improve type alignment between core and server schemas.
            // Core's InternalMessage has union types (string | Uint8Array | Buffer | URL)
            // for binary data, but JSON responses are always base64 strings.
            const apiHistory = expandedHistory.map((message) => toApiInternalMessage(message));
            for (const [index, message] of apiHistory.entries()) {
                const parsed = InternalMessageSchema.safeParse(message);
                if (!parsed.success) {
                    throw new DextoRuntimeError(
                        'session_history_serialization_failed',
                        ErrorScope.SESSION,
                        ErrorType.SYSTEM,
                        'Failed to serialize session history',
                        { sessionId, index, issues: zodToIssues(parsed.error) }
                    );
                }
            }
            return ctx.json(
                {
                    history: apiHistory,
                    isBusy,
                },
                200
            );
        })
        .openapi(listSessionPromptContributorsRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const contributors = await agent.getSessionSystemPromptContributors(sessionId);
            return ctx.json(
                {
                    contributors: contributors.map((contributor) => ({
                        id: contributor.id,
                        priority: contributor.priority,
                    })),
                },
                200
            );
        })
        .openapi(upsertSessionPromptContributorRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const payload = ctx.req.valid('json');

            const contributorId = sanitizeContributorId(payload.id);
            if (contributorId.length === 0) {
                throw new DextoRuntimeError(
                    'session_systemprompt_contributor_config_invalid',
                    ErrorScope.SYSTEM_PROMPT,
                    ErrorType.USER,
                    'A valid contributor id is required',
                    {
                        id: payload.id,
                        sessionId,
                    }
                );
            }

            const rawContent = payload.content ?? '';
            const content = rawContent.slice(0, MAX_SYSTEM_PROMPT_CONTRIBUTOR_CONTENT_CHARS);

            if (!payload.enabled) {
                const removed = await agent.removeSessionSystemPromptContributor(
                    sessionId,
                    contributorId
                );
                return ctx.json(
                    {
                        id: contributorId,
                        enabled: false,
                        removed,
                    },
                    200
                );
            }

            if (content.trim().length === 0) {
                throw new DextoRuntimeError(
                    'session_systemprompt_contributor_config_invalid',
                    ErrorScope.SYSTEM_PROMPT,
                    ErrorType.USER,
                    'Contributor content is required when enabled',
                    {
                        id: payload.id,
                        sessionId,
                    }
                );
            }

            const priority = payload.priority;
            const result = await agent.upsertSessionSystemPromptContributor(sessionId, {
                id: contributorId,
                priority,
                content,
            });

            return ctx.json(
                {
                    id: contributorId,
                    enabled: true,
                    priority,
                    replaced: result.replaced,
                    contentLength: content.length,
                    truncated: rawContent.length > content.length,
                },
                200
            );
        })
        .openapi(deleteRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.param();
            await agent.deleteSession(sessionId);
            return ctx.json({ status: 'deleted' as const, sessionId }, 200);
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

            return ctx.json(
                {
                    cancelled,
                    sessionId,
                    queueCleared: clearQueue,
                    clearedCount,
                },
                200
            );
        })
        .openapi(loadRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            // Validate that session exists
            const sessionIds = await agent.listSessions();
            if (!sessionIds.includes(sessionId)) {
                throw new DextoRuntimeError(
                    'session_not_found',
                    ErrorScope.SESSION,
                    ErrorType.NOT_FOUND,
                    `Session not found: ${sessionId}`,
                    { sessionId }
                );
            }

            // Return session metadata with processing status
            const metadata = await agent.getSessionMetadata(sessionId);
            const isBusy = await agent.isSessionBusy(sessionId);
            const usageSummary = await agent.getSessionUsageSummary(sessionId);
            const activeUsageScopeId = agent.getEffectiveConfig().usageScopeId ?? null;
            const activeUsageScope = activeUsageScopeId
                ? {
                      scopeId: activeUsageScopeId,
                      ...(await agent.getSessionUsageSummary(sessionId, activeUsageScopeId)),
                  }
                : null;
            return ctx.json(
                {
                    session: {
                        ...mapSessionMetadata(sessionId, metadata),
                        isBusy,
                        usageSummary,
                        activeUsageScopeId,
                        activeUsageScope,
                    },
                },
                200
            );
        })
        .openapi(clearContextRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            await agent.clearContext(sessionId);
            return ctx.json({ status: 'context cleared' as const, sessionId }, 200);
        })
        .openapi(patchRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const { title } = ctx.req.valid('json');
            await agent.setSessionTitle(sessionId, title);
            const metadata = await agent.getSessionMetadata(sessionId);
            return ctx.json(
                {
                    session: mapSessionMetadata(sessionId, metadata, { title }),
                },
                200
            );
        })
        .openapi(generateTitleRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const title = await agent.generateSessionTitle(sessionId);
            return ctx.json({ title, sessionId }, 200);
        });
}

type SessionIdParamInput = { param: { sessionId: string } };

type ListRouteSchema = OpenAPIRouteSchema<typeof listRoute, {}>;
type CreateRouteSchema = OpenAPIRouteSchema<
    typeof createRouteDef,
    { json: z.input<typeof CreateSessionSchema> }
>;
type GetRouteSchema = OpenAPIRouteSchema<typeof getRoute, SessionIdParamInput>;
type ForkRouteSchema = OpenAPIRouteSchema<typeof forkRoute, SessionIdParamInput>;
type HistoryRouteSchema = OpenAPIRouteSchema<typeof historyRoute, SessionIdParamInput>;
type ListSessionPromptContributorsRouteSchema = OpenAPIRouteSchema<
    typeof listSessionPromptContributorsRoute,
    SessionIdParamInput
>;
type UpsertSessionPromptContributorRouteSchema = OpenAPIRouteSchema<
    typeof upsertSessionPromptContributorRoute,
    SessionIdParamInput & { json: z.input<typeof UpsertSessionPromptContributorSchema> }
>;
type DeleteRouteSchema = OpenAPIRouteSchema<typeof deleteRoute, SessionIdParamInput>;
type CancelRouteSchema = OpenAPIRouteSchema<
    typeof cancelRoute,
    SessionIdParamInput & { json?: { clearQueue?: boolean } }
>;
type LoadRouteSchema = OpenAPIRouteSchema<typeof loadRoute, SessionIdParamInput>;
type ClearContextRouteSchema = OpenAPIRouteSchema<typeof clearContextRoute, SessionIdParamInput>;
type PatchRouteSchema = OpenAPIRouteSchema<
    typeof patchRoute,
    SessionIdParamInput & { json: { title: string } }
>;
type GenerateTitleRouteSchema = OpenAPIRouteSchema<typeof generateTitleRoute, SessionIdParamInput>;

export type SessionsRouterSchema =
    | ListRouteSchema
    | CreateRouteSchema
    | GetRouteSchema
    | ForkRouteSchema
    | HistoryRouteSchema
    | ListSessionPromptContributorsRouteSchema
    | UpsertSessionPromptContributorRouteSchema
    | DeleteRouteSchema
    | CancelRouteSchema
    | LoadRouteSchema
    | ClearContextRouteSchema
    | PatchRouteSchema
    | GenerateTitleRouteSchema;
