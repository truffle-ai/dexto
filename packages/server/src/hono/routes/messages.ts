import { Hono } from 'hono';
import { z } from 'zod';
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
    const app = new Hono();

    app.post('/message', async (ctx) => {
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

    app.post('/message-sync', async (ctx) => {
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

    app.post('/reset', async (ctx) => {
        logger.info('Received request via POST /api/reset');
        const { sessionId } = await parseJson(ctx, ResetBodySchema);
        await agent.resetConversation(sessionId);
        return sendJson(ctx, { status: 'reset initiated', sessionId });
    });

    return app;
}
