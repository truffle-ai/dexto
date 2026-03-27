import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DextoRuntimeError, ErrorType, type DextoAgent, type ContentPart } from '@dexto/core';
import { ApiErrorResponseSchema, ContentPartSchema } from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

// Schema for queued message in responses
const QueuedMessageSchema = z
    .object({
        id: z.string().describe('Unique identifier for the queued message'),
        content: z.array(ContentPartSchema).describe('Message content parts'),
        queuedAt: z.number().describe('Unix timestamp when message was queued'),
        metadata: z.record(z.unknown()).optional().describe('Optional metadata'),
        kind: z.enum(['default', 'background']).optional().describe('Optional queued message kind'),
    })
    .strict()
    .describe('A message waiting in the queue');

// ContentPart schemas matching @dexto/core types
// TODO: Same as messages.ts - Zod-inferred types don't exactly match core's ContentInput
// due to exactOptionalPropertyTypes. We cast to ContentPart after validation.
const TextPartSchema = z
    .object({
        type: z.literal('text').describe('Content type identifier'),
        text: z.string().describe('Text content'),
    })
    .describe('Text content part');

const ImagePartSchema = z
    .object({
        type: z.literal('image').describe('Content type identifier'),
        image: z.string().describe('Base64-encoded image data or URL'),
        mimeType: z.string().optional().describe('MIME type (e.g., image/png)'),
    })
    .describe('Image content part');

const FilePartSchema = z
    .object({
        type: z.literal('file').describe('Content type identifier'),
        data: z.string().describe('Base64-encoded file data or URL'),
        mimeType: z.string().describe('MIME type (e.g., application/pdf)'),
        filename: z.string().optional().describe('Optional filename'),
    })
    .describe('File content part');

const QueueContentPartSchema = z
    .discriminatedUnion('type', [TextPartSchema, ImagePartSchema, FilePartSchema])
    .describe('Content part - text, image, or file');

// Schema for queue message request body - matches messages.ts MessageBodySchema
const QueueMessageBodySchema = z
    .object({
        content: z
            .union([z.string(), z.array(QueueContentPartSchema)])
            .describe('Message content - string for text, or ContentPart[] for multimodal'),
        kind: z.enum(['default', 'background']).optional().describe('Optional queued message kind'),
    })
    .describe('Request body for queueing a message');

function serializeBinaryValue(value: string | Uint8Array | Buffer | ArrayBuffer | URL): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof URL) {
        return value.toString();
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(value)).toString('base64');
    }
    return Buffer.from(value).toString('base64');
}

function toQueueRequestContent(
    rawContent: z.output<typeof QueueMessageBodySchema>['content']
): ContentPart[] {
    if (typeof rawContent === 'string') {
        return [{ type: 'text', text: rawContent }];
    }

    return rawContent.map((part) => {
        switch (part.type) {
            case 'text':
                return {
                    type: 'text',
                    text: part.text,
                };
            case 'image':
                return {
                    type: 'image',
                    image: part.image,
                    ...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
                };
            case 'file':
                return {
                    type: 'file',
                    data: part.data,
                    mimeType: part.mimeType,
                    ...(part.filename !== undefined ? { filename: part.filename } : {}),
                };
        }
    });
}

function toQueueResponseContentPart(part: ContentPart): z.output<typeof ContentPartSchema> {
    switch (part.type) {
        case 'text':
            return {
                type: 'text',
                text: part.text,
            };
        case 'image':
            return {
                type: 'image',
                image: serializeBinaryValue(part.image),
                ...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
            };
        case 'file':
            return {
                type: 'file',
                data: serializeBinaryValue(part.data),
                mimeType: part.mimeType,
                ...(part.filename !== undefined ? { filename: part.filename } : {}),
            };
        case 'ui-resource':
            return {
                type: 'ui-resource',
                uri: part.uri,
                mimeType: part.mimeType,
                ...(part.content !== undefined ? { content: part.content } : {}),
                ...(part.blob !== undefined ? { blob: part.blob } : {}),
                ...(part.metadata !== undefined ? { metadata: part.metadata } : {}),
            };
    }
}

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
                        schema: z
                            .object({
                                messages: z.array(QueuedMessageSchema).describe('Queued messages'),
                                count: z.number().describe('Number of messages in queue'),
                            })
                            .strict(),
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
                        schema: z
                            .object({
                                queued: z.literal(true).describe('Indicates message was queued'),
                                id: z.string().describe('ID of the queued message'),
                                position: z.number().describe('Position in the queue (1-based)'),
                            })
                            .strict(),
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
                        schema: z
                            .object({
                                removed: z.literal(true).describe('Indicates message was removed'),
                                id: z.string().describe('ID of the removed message'),
                            })
                            .strict(),
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
                        schema: z
                            .object({
                                cleared: z.literal(true).describe('Indicates queue was cleared'),
                                count: z.number().describe('Number of messages that were removed'),
                            })
                            .strict(),
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
                content: message.content.map(toQueueResponseContentPart),
                queuedAt: message.queuedAt,
                ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
                ...(message.kind !== undefined ? { kind: message.kind } : {}),
            }));
            return ctx.json(
                {
                    messages: responseMessages,
                    count: responseMessages.length,
                },
                200
            );
        })
        .openapi(queueMessageRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');
            const { content: rawContent } = ctx.req.valid('json');
            const content = toQueueRequestContent(rawContent);

            const { kind } = ctx.req.valid('json');
            const result = await agent.queueMessage(sessionId, {
                content,
                ...(kind !== undefined && { kind }),
            });
            return ctx.json(
                {
                    queued: result.queued,
                    id: result.id,
                    position: result.position,
                },
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
            return ctx.json({ removed: true, id: messageId }, 200);
        })
        .openapi(clearQueueRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('param');

            const count = await agent.clearMessageQueue(sessionId);
            return ctx.json({ cleared: true, count }, 200);
        });
}
