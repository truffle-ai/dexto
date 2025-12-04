import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import type { UserMessageContentPart } from '@dexto/core';
import { ContentPartSchema } from '../schemas/responses.js';

// Input schemas for user message content parts (stricter than response schemas)
// These use required mimeType to avoid exactOptionalPropertyTypes issues
const TextPartInputSchema = z
    .object({
        type: z.literal('text').describe('Content part type'),
        text: z.string().describe('The text content'),
    })
    .strict()
    .describe('A text content part');

const ImagePartInputSchema = z
    .object({
        type: z.literal('image').describe('Content part type'),
        image: z.string().describe('Base64-encoded image data'),
        mimeType: z.string().describe('MIME type of the image'),
    })
    .strict()
    .describe('An image content part');

const FilePartInputSchema = z
    .object({
        type: z.literal('file').describe('Content part type'),
        data: z.string().describe('Base64-encoded file data'),
        mimeType: z.string().describe('MIME type of the file'),
        filename: z.string().optional().describe('Optional filename'),
    })
    .strict()
    .describe('A file content part');

const UserContentPartInputSchema = z
    .discriminatedUnion('type', [TextPartInputSchema, ImagePartInputSchema, FilePartInputSchema])
    .describe('A user message content part (text, image, or file)');

// Schema for queued message in responses
const QueuedMessageSchema = z
    .object({
        id: z.string().describe('Unique identifier for the queued message'),
        content: z.array(ContentPartSchema).describe('Message content parts'),
        queuedAt: z.number().describe('Unix timestamp when message was queued'),
        metadata: z.record(z.unknown()).optional().describe('Optional metadata'),
    })
    .strict()
    .describe('A message waiting in the queue');

// Schema for queue message request body
const QueueMessageBodySchema = z
    .object({
        message: z.string().optional().describe('Text message to queue'),
        imageData: z
            .object({
                image: z.string().describe('Base64-encoded image data'),
                mimeType: z.string().describe('MIME type of the image'),
            })
            .optional()
            .describe('Optional image data'),
        fileData: z
            .object({
                data: z.string().describe('Base64-encoded file data'),
                mimeType: z.string().describe('MIME type of the file'),
                filename: z.string().optional().describe('Optional filename'),
            })
            .optional()
            .describe('Optional file data'),
    })
    .refine(
        (data) => {
            const msg = (data.message ?? '').trim();
            return msg.length > 0 || !!data.imageData || !!data.fileData;
        },
        { message: 'Must provide either message text, image data, or file data' }
    )
    .describe('Request body for queueing a message');

// Schema for update request body
const UpdateQueuedMessageBodySchema = z
    .object({
        content: z.array(UserContentPartInputSchema).min(1).describe('New content for the message'),
    })
    .strict()
    .describe('Request body for updating a queued message');

export function createQueueRouter(getAgent: () => DextoAgent) {
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
            404: { description: 'Session not found' },
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
            404: { description: 'Session not found' },
        },
    });

    // PUT /queue/:sessionId/:messageId - Update a queued message
    const updateQueuedMessageRoute = createRoute({
        method: 'put',
        path: '/queue/{sessionId}/{messageId}',
        summary: 'Update queued message',
        description: "Updates the content of a message that's waiting in the queue",
        tags: ['queue'],
        request: {
            params: z.object({
                sessionId: z.string().min(1).describe('Session ID'),
                messageId: z.string().min(1).describe('ID of the queued message'),
            }),
            body: {
                content: { 'application/json': { schema: UpdateQueuedMessageBodySchema } },
            },
        },
        responses: {
            200: {
                description: 'Message updated successfully',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                updated: z.literal(true).describe('Indicates message was updated'),
                                id: z.string().describe('ID of the updated message'),
                            })
                            .strict(),
                    },
                },
            },
            404: { description: 'Session or message not found' },
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
            404: { description: 'Session or message not found' },
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
            404: { description: 'Session not found' },
        },
    });

    return app
        .openapi(getQueueRoute, async (ctx) => {
            const agent = getAgent();
            const { sessionId } = ctx.req.valid('param');

            const messages = await agent.getQueuedMessages(sessionId);
            return ctx.json({
                messages,
                count: messages.length,
            });
        })
        .openapi(queueMessageRoute, async (ctx) => {
            const agent = getAgent();
            const { sessionId } = ctx.req.valid('param');
            const { message, imageData, fileData } = ctx.req.valid('json');

            // Build content array from input
            const content: Array<
                | { type: 'text'; text: string }
                | { type: 'image'; image: string; mimeType: string }
                | { type: 'file'; data: string; mimeType: string; filename?: string }
            > = [];

            if (message?.trim()) {
                content.push({ type: 'text', text: message.trim() });
            }
            if (imageData) {
                content.push({
                    type: 'image',
                    image: imageData.image,
                    mimeType: imageData.mimeType,
                });
            }
            if (fileData) {
                content.push({
                    type: 'file',
                    data: fileData.data,
                    mimeType: fileData.mimeType,
                    ...(fileData.filename && { filename: fileData.filename }),
                });
            }

            const result = await agent.queueMessage(sessionId, { content });
            return ctx.json(
                {
                    queued: result.queued,
                    id: result.id,
                    position: result.position,
                },
                201
            );
        })
        .openapi(updateQueuedMessageRoute, async (ctx) => {
            const agent = getAgent();
            const { sessionId, messageId } = ctx.req.valid('param');
            const { content } = ctx.req.valid('json');

            // Transform content to strip undefined values (Zod optional produces T | undefined,
            // but exactOptionalPropertyTypes requires absent OR T, not undefined)
            const normalizedContent: UserMessageContentPart[] = content.map((part) => {
                if (part.type === 'file') {
                    const { filename, ...rest } = part;
                    return filename !== undefined ? { ...rest, filename } : rest;
                }
                return part;
            });

            const updated = await agent.updateQueuedMessage(
                sessionId,
                messageId,
                normalizedContent
            );
            if (!updated) {
                return ctx.json({ error: 'Message not found in queue' }, 404);
            }
            return ctx.json({ updated: true, id: messageId });
        })
        .openapi(removeQueuedMessageRoute, async (ctx) => {
            const agent = getAgent();
            const { sessionId, messageId } = ctx.req.valid('param');

            const removed = await agent.removeQueuedMessage(sessionId, messageId);
            if (!removed) {
                return ctx.json({ error: 'Message not found in queue' }, 404);
            }
            return ctx.json({ removed: true, id: messageId });
        })
        .openapi(clearQueueRoute, async (ctx) => {
            const agent = getAgent();
            const { sessionId } = ctx.req.valid('param');

            const count = await agent.clearMessageQueue(sessionId);
            return ctx.json({ cleared: true, count });
        });
}
