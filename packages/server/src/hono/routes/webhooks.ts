import { Hono } from 'hono';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';
import { WebhookEventSubscriber } from '../../events/webhook-subscriber.js';
import type { WebhookConfig } from '../../events/webhook-types.js';
import { sendJson } from '../utils/response.js';
import { parseJson, parseParam } from '../utils/validation.js';

const WebhookBodySchema = z.object({
    url: z.string().url('Invalid URL format'),
    secret: z.string().optional(),
    description: z.string().optional(),
});

const WebhookParamSchema = z.object({
    webhookId: z.string(),
});

export function createWebhooksRouter(
    _agent: DextoAgent,
    webhookSubscriber: WebhookEventSubscriber
) {
    const app = new Hono();

    app.post('/webhooks', async (ctx) => {
        const { url, secret, description } = await parseJson(ctx, WebhookBodySchema);

        const webhookId = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const webhook: WebhookConfig = {
            id: webhookId,
            url,
            createdAt: new Date(),
            ...(secret && { secret }),
            ...(description && { description }),
        };

        webhookSubscriber.addWebhook(webhook);
        logger.info(`Webhook registered: ${webhookId} -> ${url}`);

        return sendJson(
            ctx,
            {
                webhook: {
                    id: webhook.id,
                    url: webhook.url,
                    description: webhook.description,
                    createdAt: webhook.createdAt,
                },
            },
            201
        );
    });

    app.get('/webhooks', async (ctx) => {
        const webhooks = webhookSubscriber.getWebhooks().map((webhook) => ({
            id: webhook.id,
            url: webhook.url,
            description: webhook.description,
            createdAt: webhook.createdAt,
        }));

        return sendJson(ctx, { webhooks });
    });

    app.get('/webhooks/:webhookId', (ctx) => {
        const { webhookId } = parseParam(ctx, WebhookParamSchema);
        const webhook = webhookSubscriber.getWebhook(webhookId);
        if (!webhook) {
            return sendJson(ctx, { error: 'Webhook not found' }, 404);
        }

        return sendJson(ctx, {
            webhook: {
                id: webhook.id,
                url: webhook.url,
                description: webhook.description,
                createdAt: webhook.createdAt,
            },
        });
    });

    app.delete('/webhooks/:webhookId', (ctx) => {
        const { webhookId } = parseParam(ctx, WebhookParamSchema);
        const removed = webhookSubscriber.removeWebhook(webhookId);
        if (!removed) {
            return sendJson(ctx, { error: 'Webhook not found' }, 404);
        }
        logger.info(`Webhook removed: ${webhookId}`);
        return sendJson(ctx, { status: 'removed', webhookId });
    });

    app.post('/webhooks/:webhookId/test', async (ctx) => {
        const { webhookId } = parseParam(ctx, WebhookParamSchema);
        const webhook = webhookSubscriber.getWebhook(webhookId);

        if (!webhook) {
            return sendJson(ctx, { error: 'Webhook not found' }, 404);
        }

        logger.info(`Testing webhook: ${webhookId}`);
        const result = await webhookSubscriber.testWebhook(webhookId);

        return sendJson(ctx, {
            test: 'completed',
            result: {
                success: result.success,
                statusCode: result.statusCode,
                responseTime: result.responseTime,
                error: result.error,
            },
        });
    });

    return app;
}
