import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';

const MessageBodySchema = z
    .object({
        message: z.string().optional().describe('The user message text'),
        sessionId: z.string().optional().describe('The session to use for this message'),
        stream: z
            .boolean()
            .optional()
            .describe('Set to true to receive streaming chunks over WebSocket'),
        imageData: z
            .object({
                base64: z.string().describe('Base64-encoded image data'),
                mimeType: z.string().describe('The MIME type of the image (e.g., image/png)'),
            })
            .optional()
            .describe('Optional image data to include with the message'),
        fileData: z
            .object({
                base64: z.string().describe('Base64-encoded file data'),
                mimeType: z.string().describe('The MIME type of the file (e.g., application/pdf)'),
                filename: z.string().optional().describe('The filename'),
            })
            .optional()
            .describe('Optional file data to include with the message'),
    })
    .refine(
        (data) => {
            const msg = (data.message ?? '').trim();
            return msg.length > 0 || !!data.imageData || !!data.fileData;
        },
        { message: 'Must provide either message text, image data, or file data' }
    );

const ResetBodySchema = z.object({
    sessionId: z.string().optional().describe('The ID of the session to reset'),
});

export function createMessagesRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const messageRoute = createRoute({
        method: 'post',
        path: '/message',
        summary: 'Send Message (async)',
        description:
            'Sends a message and returns immediately. The full response will be sent over WebSocket',
        tags: ['messages'],
        request: {
            body: {
                content: { 'application/json': { schema: MessageBodySchema } },
            },
        },
        responses: {
            202: {
                description: 'Message queued',
                content: { 'application/json': { schema: z.any() } },
            },
            400: { description: 'Validation error' },
        },
    });
    app.openapi(messageRoute, async (ctx) => {
        const agent = getAgent();
        logger.info('Received message via POST /api/message');
        const { message, sessionId, stream, imageData, fileData } = ctx.req.valid('json');

        const imageDataInput = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;

        const fileDataInput = fileData
            ? {
                  data: fileData.base64,
                  mimeType: fileData.mimeType,
                  ...(fileData.filename && { filename: fileData.filename }),
              }
            : undefined;

        if (imageDataInput) logger.info('Image data included in message.');
        if (fileDataInput) logger.info('File data included in message.');
        if (sessionId) logger.info(`Message for session: ${sessionId}`);

        const response = await agent.run(
            message || '',
            imageDataInput,
            fileDataInput,
            sessionId,
            stream || false
        );

        return ctx.json({ response, sessionId }, 202);
    });

    const messageSyncRoute = createRoute({
        method: 'post',
        path: '/message-sync',
        summary: 'Send Message (sync)',
        description: 'Sends a message and waits for the full response',
        tags: ['messages'],
        request: {
            body: { content: { 'application/json': { schema: MessageBodySchema } } },
        },
        responses: {
            200: {
                description: 'Synchronous response',
                content: { 'application/json': { schema: z.any() } },
            },
            400: { description: 'Validation error' },
        },
    });
    app.openapi(messageSyncRoute, async (ctx) => {
        const agent = getAgent();
        logger.info('Received message via POST /api/message-sync');
        const { message, sessionId, imageData, fileData } = ctx.req.valid('json');

        const imageDataInput = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;

        const fileDataInput = fileData
            ? {
                  data: fileData.base64,
                  mimeType: fileData.mimeType,
                  ...(fileData.filename && { filename: fileData.filename }),
              }
            : undefined;

        if (imageDataInput) logger.info('Image data included in message.');
        if (fileDataInput) logger.info('File data included in message.');
        if (sessionId) logger.info(`Message for session: ${sessionId}`);

        const response = await agent.run(
            message || '',
            imageDataInput,
            fileDataInput,
            sessionId,
            false
        );
        return ctx.json({ response, sessionId });
    });

    const resetRoute = createRoute({
        method: 'post',
        path: '/reset',
        summary: 'Reset Conversation',
        description: 'Resets the conversation history for a given session',
        tags: ['messages'],
        request: {
            body: { content: { 'application/json': { schema: ResetBodySchema } } },
        },
        responses: {
            200: {
                description: 'Reset initiated',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(resetRoute, async (ctx) => {
        const agent = getAgent();
        logger.info('Received request via POST /api/reset');
        const { sessionId } = ctx.req.valid('json');
        await agent.resetConversation(sessionId);
        return ctx.json({ status: 'reset initiated', sessionId });
    });

    return app;
}
