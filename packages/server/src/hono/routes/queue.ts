import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DextoRuntimeError, ErrorType, type QueuedMessage } from '@dexto/core';
import {
    ApiErrorResponseSchema,
    BadRequestErrorResponse,
    ContentPartSchema,
    InternalErrorResponse,
    JsonObjectSchema,
    RequestContentSchema,
    toApiContentPart,
    toContentInput,
} from '../schemas/responses.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';

// Schema for queued message in responses
const QueuedMessageSchema = z
    .object({
        id: z.string().describe('Unique identifier for the queued message'),
        content: z.array(ContentPartSchema).describe('Message content parts'),
        queuedAt: z.number().describe('Unix timestamp when message was queued'),
        metadata: JsonObjectSchema.optional().describe('Optional metadata'),
        kind: z.enum(['default', 'background']).optional().describe('Optional queued message kind'),
    })
    .strict()
    .describe('A message waiting in the queue');

// Schema for queue message request body - matches messages.ts MessageBodySchema
const QueueMessageBodySchema = z
    .object({
        content: RequestContentSchema,
        kind: z.enum(['default', 'background']).optional().describe('Optional queued message kind'),
    })
    .describe('Request body for queueing a message');

const GetQueueResponseSchema = z
    .object({
        messages: z.array(QueuedMessageSchema).describe('Queued messages'),
        count: z.number().describe('Number of messages in queue'),
    })
    .strict()
    .describe('Get queue response');

const QueueMessageResponseSchema = z
    .object({
        queued: z.literal(true).describe('Indicates message was queued'),
        id: z.string().describe('ID of the queued message'),
        position: z.number().describe('Position in the queue (1-based)'),
    })
    .strict()
    .describe('Queue message response');

const RemoveQueuedMessageResponseSchema = z
    .object({
        removed: z.literal(true).describe('Indicates message was removed'),
        id: z.string().describe('ID of the removed message'),
    })
    .strict()
    .describe('Remove queued message response');

const ClearQueueResponseSchema = z
    .object({
        cleared: z.literal(true).describe('Indicates queue was cleared'),
        count: z.number().describe('Number of messages that were removed'),
    })
    .strict()
    .describe('Clear queue response');

const QueueSessionParamSchema = z
    .object({
        sessionId: z.string().min(1).describe('Session ID'),
    })
    .describe('Queue session params');

const QueueMessageParamSchema = z
    .object({
        sessionId: z.string().min(1).describe('Session ID'),
        messageId: z.string().min(1).describe('ID of the queued message to remove'),
    })
    .describe('Queue message identifier params');

const getQueueRoute = createRoute({
    method: 'get',
    path: '/queue/{sessionId}',
    summary: 'Get queued messages',
    description: 'Returns all messages waiting in the queue for a session',
    tags: ['queue'],
    request: {
        params: QueueSessionParamSchema,
    },
    responses: {
        200: {
            description: 'List of queued messages',
            content: {
                'application/json': {
                    schema: GetQueueResponseSchema,
                },
            },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const queueMessageRoute = createRoute({
    method: 'post',
    path: '/queue/{sessionId}',
    summary: 'Queue a message',
    description: 'Adds a message to the queue for processing when the session is no longer busy',
    tags: ['queue'],
    request: {
        params: QueueSessionParamSchema,
        body: {
            content: { 'application/json': { schema: QueueMessageBodySchema } },
        },
    },
    responses: {
        201: {
            description: 'Message queued successfully',
            content: {
                'application/json': {
                    schema: QueueMessageResponseSchema,
                },
            },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const removeQueuedMessageRoute = createRoute({
    method: 'delete',
    path: '/queue/{sessionId}/{messageId}',
    summary: 'Remove queued message',
    description: 'Removes a specific message from the queue',
    tags: ['queue'],
    request: {
        params: QueueMessageParamSchema,
    },
    responses: {
        200: {
            description: 'Message removed successfully',
            content: {
                'application/json': {
                    schema: RemoveQueuedMessageResponseSchema,
                },
            },
        },
        404: {
            description: 'Session or message not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const clearQueueRoute = createRoute({
    method: 'delete',
    path: '/queue/{sessionId}',
    summary: 'Clear message queue',
    description: 'Removes all messages from the queue for a session',
    tags: ['queue'],
    request: {
        params: QueueSessionParamSchema,
    },
    responses: {
        200: {
            description: 'Queue cleared successfully',
            content: {
                'application/json': {
                    schema: ClearQueueResponseSchema,
                },
            },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const getSteerRoute = createRoute({
    method: 'get',
    path: '/steer/{sessionId}',
    summary: 'Get steer messages',
    description: 'Returns active-turn steer messages waiting for the next executor boundary',
    tags: ['steer'],
    request: { params: QueueSessionParamSchema },
    responses: {
        200: {
            description: 'List of steer messages',
            content: { 'application/json': { schema: GetQueueResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const steerRoute = createRoute({
    method: 'post',
    path: '/steer/{sessionId}',
    summary: 'Queue active-turn steer input',
    description: 'Adds a message to be injected into the current active turn',
    tags: ['steer'],
    request: {
        params: QueueSessionParamSchema,
        body: { content: { 'application/json': { schema: QueueMessageBodySchema } } },
    },
    responses: {
        201: {
            description: 'Steer message queued successfully',
            content: { 'application/json': { schema: QueueMessageResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const removeSteerRoute = createRoute({
    method: 'delete',
    path: '/steer/{sessionId}/{messageId}',
    summary: 'Remove steer message',
    description: 'Removes a specific active-turn steer message',
    tags: ['steer'],
    request: { params: QueueMessageParamSchema },
    responses: {
        200: {
            description: 'Steer message removed successfully',
            content: { 'application/json': { schema: RemoveQueuedMessageResponseSchema } },
        },
        404: {
            description: 'Session or message not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const clearSteerRoute = createRoute({
    method: 'delete',
    path: '/steer/{sessionId}',
    summary: 'Clear steer queue',
    description: 'Removes all active-turn steer messages for a session',
    tags: ['steer'],
    request: { params: QueueSessionParamSchema },
    responses: {
        200: {
            description: 'Steer queue cleared successfully',
            content: { 'application/json': { schema: ClearQueueResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const getFollowUpRoute = createRoute({
    method: 'get',
    path: '/follow-up/{sessionId}',
    summary: 'Get follow-up messages',
    description: 'Returns queued follow-up messages that will run after the active turn stops',
    tags: ['follow-up'],
    request: { params: QueueSessionParamSchema },
    responses: {
        200: {
            description: 'List of follow-up messages',
            content: { 'application/json': { schema: GetQueueResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const followUpRoute = createRoute({
    method: 'post',
    path: '/follow-up/{sessionId}',
    summary: 'Queue follow-up input',
    description: 'Adds a message to run as a follow-up after the active turn stops',
    tags: ['follow-up'],
    request: {
        params: QueueSessionParamSchema,
        body: { content: { 'application/json': { schema: QueueMessageBodySchema } } },
    },
    responses: {
        201: {
            description: 'Follow-up message queued successfully',
            content: { 'application/json': { schema: QueueMessageResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const removeFollowUpRoute = createRoute({
    method: 'delete',
    path: '/follow-up/{sessionId}/{messageId}',
    summary: 'Remove follow-up message',
    description: 'Removes a specific queued follow-up message',
    tags: ['follow-up'],
    request: { params: QueueMessageParamSchema },
    responses: {
        200: {
            description: 'Follow-up message removed successfully',
            content: { 'application/json': { schema: RemoveQueuedMessageResponseSchema } },
        },
        404: {
            description: 'Session or message not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const clearFollowUpRoute = createRoute({
    method: 'delete',
    path: '/follow-up/{sessionId}',
    summary: 'Clear follow-up queue',
    description: 'Removes all queued follow-up messages for a session',
    tags: ['follow-up'],
    request: { params: QueueSessionParamSchema },
    responses: {
        200: {
            description: 'Follow-up queue cleared successfully',
            content: { 'application/json': { schema: ClearQueueResponseSchema } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

function toQueueResponseMessage(message: QueuedMessage) {
    return {
        id: message.id,
        content: message.content.map(toApiContentPart),
        queuedAt: message.queuedAt,
        ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
        ...(message.kind !== undefined ? { kind: message.kind } : {}),
    };
}

function messageNotFound(
    sessionId: string,
    messageId: string,
    scope: 'steer' | 'follow_up'
): DextoRuntimeError {
    return new DextoRuntimeError(
        `${scope}_message_not_found`,
        scope,
        ErrorType.NOT_FOUND,
        'Message not found in queue',
        { sessionId, messageId }
    );
}

export function createQueueRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    return app
        .openapi(getQueueRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const messages = await agent.getQueuedMessages(sessionId);
            const responseMessages = messages.map(toQueueResponseMessage);
            return ctx.json(
                GetQueueResponseSchema.parse({
                    messages: responseMessages,
                    count: responseMessages.length,
                }),
                200
            );
        })
        .openapi(getSteerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const responseMessages = (await agent.getSteerMessages(sessionId)).map(
                toQueueResponseMessage
            );
            return ctx.json(
                GetQueueResponseSchema.parse({
                    messages: responseMessages,
                    count: responseMessages.length,
                }),
                200
            );
        })
        .openapi(steerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const { content: rawContent, kind } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            const result = await agent.steer(sessionId, {
                content,
                ...(kind !== undefined && { kind }),
            });
            return ctx.json(
                QueueMessageResponseSchema.parse({
                    queued: true as const,
                    id: result.id,
                    position: result.position,
                }),
                201
            );
        })
        .openapi(removeSteerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId, messageId } = ctx.req.valid('param');

            const removed = await agent.removeSteerMessage(sessionId, messageId);
            if (!removed) {
                throw messageNotFound(sessionId, messageId, 'steer');
            }
            return ctx.json(
                RemoveQueuedMessageResponseSchema.parse({ removed: true as const, id: messageId }),
                200
            );
        })
        .openapi(clearSteerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const count = await agent.clearSteerQueue(sessionId);
            return ctx.json(ClearQueueResponseSchema.parse({ cleared: true as const, count }), 200);
        })
        .openapi(getFollowUpRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const responseMessages = (await agent.getFollowUpMessages(sessionId)).map(
                toQueueResponseMessage
            );
            return ctx.json(
                GetQueueResponseSchema.parse({
                    messages: responseMessages,
                    count: responseMessages.length,
                }),
                200
            );
        })
        .openapi(followUpRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const { content: rawContent, kind } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            const result = await agent.followUp(sessionId, {
                content,
                ...(kind !== undefined && { kind }),
            });
            return ctx.json(
                QueueMessageResponseSchema.parse({
                    queued: true as const,
                    id: result.id,
                    position: result.position,
                }),
                201
            );
        })
        .openapi(removeFollowUpRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId, messageId } = ctx.req.valid('param');

            const removed = await agent.removeFollowUpMessage(sessionId, messageId);
            if (!removed) {
                throw messageNotFound(sessionId, messageId, 'follow_up');
            }
            return ctx.json(
                RemoveQueuedMessageResponseSchema.parse({ removed: true as const, id: messageId }),
                200
            );
        })
        .openapi(clearFollowUpRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const count = await agent.clearFollowUpQueue(sessionId);
            return ctx.json(ClearQueueResponseSchema.parse({ cleared: true as const, count }), 200);
        })
        .openapi(queueMessageRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const { content: rawContent } = ctx.req.valid('json');
            const content = toContentInput(rawContent);

            const { kind } = ctx.req.valid('json');
            const result = await agent.queueMessage(sessionId, {
                content,
                ...(kind !== undefined && { kind }),
            });
            return ctx.json(
                QueueMessageResponseSchema.parse({
                    queued: true as const,
                    id: result.id,
                    position: result.position,
                }),
                201
            );
        })
        .openapi(removeQueuedMessageRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId, messageId } = ctx.req.valid('param');

            const removed = await agent.removeQueuedMessage(sessionId, messageId);
            if (!removed) {
                throw new DextoRuntimeError(
                    'queued_message_not_found',
                    'queue',
                    ErrorType.NOT_FOUND,
                    'Message not found in queue',
                    { sessionId, messageId }
                );
            }
            return ctx.json(
                RemoveQueuedMessageResponseSchema.parse({ removed: true as const, id: messageId }),
                200
            );
        })
        .openapi(clearQueueRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const count = await agent.clearMessageQueue(sessionId);
            return ctx.json(ClearQueueResponseSchema.parse({ cleared: true as const, count }), 200);
        });
}

type QueueSessionParamInput = { param: z.input<typeof QueueSessionParamSchema> };
type QueueMessageParamInput = { param: z.input<typeof QueueMessageParamSchema> };

type GetQueueRouteSchema = OpenAPIRouteSchema<typeof getQueueRoute, QueueSessionParamInput>;
type QueueMessageRouteSchema = OpenAPIRouteSchema<
    typeof queueMessageRoute,
    QueueSessionParamInput & { json: z.input<typeof QueueMessageBodySchema> }
>;
type RemoveQueuedMessageRouteSchema = OpenAPIRouteSchema<
    typeof removeQueuedMessageRoute,
    QueueMessageParamInput
>;
type ClearQueueRouteSchema = OpenAPIRouteSchema<typeof clearQueueRoute, QueueSessionParamInput>;
type GetSteerRouteSchema = OpenAPIRouteSchema<typeof getSteerRoute, QueueSessionParamInput>;
type SteerRouteSchema = OpenAPIRouteSchema<
    typeof steerRoute,
    QueueSessionParamInput & { json: z.input<typeof QueueMessageBodySchema> }
>;
type RemoveSteerRouteSchema = OpenAPIRouteSchema<typeof removeSteerRoute, QueueMessageParamInput>;
type ClearSteerRouteSchema = OpenAPIRouteSchema<typeof clearSteerRoute, QueueSessionParamInput>;
type GetFollowUpRouteSchema = OpenAPIRouteSchema<typeof getFollowUpRoute, QueueSessionParamInput>;
type FollowUpRouteSchema = OpenAPIRouteSchema<
    typeof followUpRoute,
    QueueSessionParamInput & { json: z.input<typeof QueueMessageBodySchema> }
>;
type RemoveFollowUpRouteSchema = OpenAPIRouteSchema<
    typeof removeFollowUpRoute,
    QueueMessageParamInput
>;
type ClearFollowUpRouteSchema = OpenAPIRouteSchema<
    typeof clearFollowUpRoute,
    QueueSessionParamInput
>;

export type QueueRouterSchema =
    | GetQueueRouteSchema
    | QueueMessageRouteSchema
    | RemoveQueuedMessageRouteSchema
    | ClearQueueRouteSchema
    | GetSteerRouteSchema
    | SteerRouteSchema
    | RemoveSteerRouteSchema
    | ClearSteerRouteSchema
    | GetFollowUpRouteSchema
    | FollowUpRouteSchema
    | RemoveFollowUpRouteSchema
    | ClearFollowUpRouteSchema;
