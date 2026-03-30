import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DextoRuntimeError, ErrorType, type DextoAgent } from '@dexto/core';
import {
    ApiErrorResponseSchema,
    ContentPartSchema,
    JsonObjectSchema,
    RequestContentSchema,
    toApiContentPart,
    toContentInput,
} from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

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

export function createQueueRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    // GET /queue/:sessionId - Get all queued messages
    const getQueueRoute = createRoute({
        method: 'get',
        path: '/queue/{sessionId}',
        summary: 'Get queued messages',
        description: 'Returns all messages waiting in the queue for a session',
        tags: ['queue'],
        request: {
            params: z.object({
                sessionId: z.string().min(1).describe('Session ID'),
            }),
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
        },
    });

    // POST /queue/:sessionId - Queue a new message
    const queueMessageRoute = createRoute({
        method: 'post',
        path: '/queue/{sessionId}',
        summary: 'Queue a message',
        description:
            'Adds a message to the queue for processing when the session is no longer busy',
        tags: ['queue'],
        request: {
            params: z.object({
                sessionId: z.string().min(1).describe('Session ID'),
            }),
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
        },
    });

    // DELETE /queue/:sessionId/:messageId - Remove a specific queued message
    const removeQueuedMessageRoute = createRoute({
        method: 'delete',
        path: '/queue/{sessionId}/{messageId}',
        summary: 'Remove queued message',
        description: 'Removes a specific message from the queue',
        tags: ['queue'],
        request: {
            params: z.object({
                sessionId: z.string().min(1).describe('Session ID'),
                messageId: z.string().min(1).describe('ID of the queued message to remove'),
            }),
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
        },
    });

    // DELETE /queue/:sessionId - Clear all queued messages
    const clearQueueRoute = createRoute({
        method: 'delete',
        path: '/queue/{sessionId}',
        summary: 'Clear message queue',
        description: 'Removes all messages from the queue for a session',
        tags: ['queue'],
        request: {
            params: z.object({
                sessionId: z.string().min(1).describe('Session ID'),
            }),
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
        },
    });

    return app
        .openapi(getQueueRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const messages = await agent.getQueuedMessages(sessionId);
            const responseMessages = messages.map((message) => ({
                id: message.id,
                content: message.content.map(toApiContentPart),
                queuedAt: message.queuedAt,
                ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
                ...(message.kind !== undefined ? { kind: message.kind } : {}),
            }));
            return ctx.json(
                GetQueueResponseSchema.parse({
                    messages: responseMessages,
                    count: responseMessages.length,
                }),
                200
            );
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
