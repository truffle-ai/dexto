import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
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
    const app = new OpenAPIHono();

    const registerRoute = createRoute({
        method: 'post',
        path: '/webhooks',
        tags: ['webhooks'],
        request: { body: { content: { 'application/json': { schema: WebhookBodySchema } } } },
        responses: {
            201: {
                description: 'Webhook registered',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(registerRoute, async (ctx: any) => {
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

    const listRoute = createRoute({
        method: 'get',
        path: '/webhooks',
        tags: ['webhooks'],
        responses: {
            200: {
                description: 'List webhooks',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    (app as any).openapi(listRoute, async (ctx: any) => {
        const webhooks = webhookSubscriber.getWebhooks().map((webhook) => ({
            id: webhook.id,
            url: webhook.url,
            description: webhook.description,
            createdAt: webhook.createdAt,
        }));

        return sendJson(ctx, { webhooks });
    });

    const getRoute = createRoute({
        method: 'get',
        path: '/webhooks/{webhookId}',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string() }) },
        responses: {
            200: { description: 'Webhook', content: { 'application/json': { schema: z.any() } } },
            404: { description: 'Not found' },
        },
    });
    (app as any).openapi(getRoute, (ctx: any) => {
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

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/webhooks/{webhookId}',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string() }) },
        responses: {
            200: { description: 'Removed', content: { 'application/json': { schema: z.any() } } },
            404: { description: 'Not found' },
        },
    });
    (app as any).openapi(deleteRoute, (ctx: any) => {
        const { webhookId } = parseParam(ctx, WebhookParamSchema);
        const removed = webhookSubscriber.removeWebhook(webhookId);
        if (!removed) {
            return sendJson(ctx, { error: 'Webhook not found' }, 404);
        }
        logger.info(`Webhook removed: ${webhookId}`);
        return sendJson(ctx, { status: 'removed', webhookId });
    });

    const testRoute = createRoute({
        method: 'post',
        path: '/webhooks/{webhookId}/test',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string() }) },
        responses: {
            200: {
                description: 'Test result',
                content: { 'application/json': { schema: z.any() } },
            },
            404: { description: 'Not found' },
        },
    });
    (app as any).openapi(testRoute, async (ctx: any) => {
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
