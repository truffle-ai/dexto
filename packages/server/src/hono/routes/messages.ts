import { OpenAPIHono, createRoute, z, type OpenAPIContext } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import { sendJson } from '../utils/response.js';
import { parseJson } from '../utils/validation.js';

const MessageBodySchema = z
    .object({
        message: z.string().optional(),
        sessionId: z.string().optional(),
        stream: z.boolean().optional(),
        imageData: z
            .object({
                base64: z.string(),
                mimeType: z.string(),
            })
            .optional(),
        fileData: z
            .object({
                base64: z.string(),
                mimeType: z.string(),
                filename: z.string().optional(),
            })
            .optional(),
    })
    .refine(
        (data) => {
            const msg = (data.message ?? '').trim();
            return msg.length > 0 || !!data.imageData || !!data.fileData;
        },
        { message: 'Must provide either message text, image data, or file data' }
    );

const ResetBodySchema = z.object({
    sessionId: z.string().optional(),
});

export function createMessagesRouter(agent: DextoAgent) {
    const app = new OpenAPIHono();

    const messageRoute = createRoute({
        method: 'post',
        path: '/message',
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
    app.openapi(messageRoute, async (ctx: OpenAPIContext<typeof messageRoute>) => {
        logger.info('Received message via POST /api/message');
        const { message, sessionId, stream, imageData, fileData } = await parseJson(
            ctx,
            MessageBodySchema
        );

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

        return sendJson(ctx, { response, sessionId }, 202);
    });

    const messageSyncRoute = createRoute({
        method: 'post',
        path: '/message-sync',
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
    app.openapi(messageSyncRoute, async (ctx: OpenAPIContext<typeof messageSyncRoute>) => {
        logger.info('Received message via POST /api/message-sync');
        const { message, sessionId, imageData, fileData } = await parseJson(ctx, MessageBodySchema);

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
        return sendJson(ctx, { response, sessionId });
    });

    const resetRoute = createRoute({
        method: 'post',
        path: '/reset',
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
    app.openapi(resetRoute, async (ctx: OpenAPIContext<typeof resetRoute>) => {
        logger.info('Received request via POST /api/reset');
        const { sessionId } = await parseJson(ctx, ResetBodySchema);
        await agent.resetConversation(sessionId);
        return sendJson(ctx, { status: 'reset initiated', sessionId });
    });

    return app;
}
