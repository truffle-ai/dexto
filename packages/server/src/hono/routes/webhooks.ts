import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { WebhookEventSubscriber } from '../../events/webhook-subscriber.js';
import type { WebhookConfig } from '../../events/webhook-types.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

// Response schemas
const WebhookResponseSchema = z
    .object({
        id: z.string().describe('Unique webhook identifier'),
        url: z.string().url().describe('Webhook URL'),
        description: z.string().optional().describe('Webhook description'),
        createdAt: z.union([z.date(), z.number()]).describe('Creation timestamp (Date or Unix ms)'),
    })
    .strict()
    .describe('Webhook response object');

const WebhookTestResultSchema = z
    .object({
        success: z.boolean().describe('Whether the webhook test succeeded'),
        statusCode: z.number().optional().describe('HTTP status code from webhook'),
        responseTime: z.number().optional().describe('Response time in milliseconds'),
        error: z.string().optional().describe('Error message if test failed'),
    })
    .strict()
    .describe('Webhook test result');

const WebhookBodySchema = z
    .object({
        url: z
            .string()
            .url('Invalid URL format')
            .describe('The URL to send webhook events to (must be a valid HTTP/HTTPS URL)'),
        secret: z.string().optional().describe('A secret key for HMAC signature verification'),
        description: z.string().optional().describe('A description of the webhook for reference'),
    })
    .describe('Request body for registering a webhook');

export function createWebhooksRouter(
    getAgent: GetAgentFn,
    webhookSubscriber: WebhookEventSubscriber
) {
    const app = new OpenAPIHono();

    const registerRoute = createRoute({
        method: 'post',
        path: '/webhooks',
        summary: 'Register Webhook',
        description: 'Registers a new webhook endpoint to receive agent events',
        tags: ['webhooks'],
        request: { body: { content: { 'application/json': { schema: WebhookBodySchema } } } },
        responses: {
            201: {
                description: 'Webhook registered',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                webhook: WebhookResponseSchema.describe(
                                    'Registered webhook details'
                                ),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const listRoute = createRoute({
        method: 'get',
        path: '/webhooks',
        summary: 'List Webhooks',
        description: 'Retrieves a list of all registered webhooks',
        tags: ['webhooks'],
        responses: {
            200: {
                description: 'List webhooks',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                webhooks: z
                                    .array(WebhookResponseSchema)
                                    .describe('Array of registered webhooks'),
                            })
                            .strict(),
                    },
                },
            },
        },
    });

    const getRoute = createRoute({
        method: 'get',
        path: '/webhooks/{webhookId}',
        summary: 'Get Webhook Details',
        description: 'Fetches details for a specific webhook',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string().describe('The webhook identifier') }) },
        responses: {
            200: {
                description: 'Webhook',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                webhook: WebhookResponseSchema.describe('Webhook details'),
                            })
                            .strict(),
                    },
                },
            },
            404: { description: 'Not found' },
        },
    });

    const deleteRoute = createRoute({
        method: 'delete',
        path: '/webhooks/{webhookId}',
        summary: 'Delete Webhook',
        description: 'Permanently removes a webhook endpoint. This action cannot be undone',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string().describe('The webhook identifier') }) },
        responses: {
            200: {
                description: 'Removed',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                status: z
                                    .literal('removed')
                                    .describe('Operation status indicating successful removal'),
                                webhookId: z.string().describe('ID of the removed webhook'),
                            })
                            .strict(),
                    },
                },
            },
            404: { description: 'Not found' },
        },
    });

    const testRoute = createRoute({
        method: 'post',
        path: '/webhooks/{webhookId}/test',
        summary: 'Test Webhook',
        description: 'Sends a sample event to test webhook connectivity and configuration',
        tags: ['webhooks'],
        request: { params: z.object({ webhookId: z.string().describe('The webhook identifier') }) },
        responses: {
            200: {
                description: 'Test result',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                test: z
                                    .literal('completed')
                                    .describe('Test status indicating completion'),
                                result: WebhookTestResultSchema.describe('Test execution results'),
                            })
                            .strict(),
                    },
                },
            },
            404: { description: 'Not found' },
        },
    });

    return app
        .openapi(registerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { url, secret, description } = ctx.req.valid('json');

            const webhookId = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            const webhook: WebhookConfig = {
                id: webhookId,
                url,
                createdAt: new Date(),
                ...(secret && { secret }),
                ...(description && { description }),
            };

            webhookSubscriber.addWebhook(webhook);
            agent.logger.info(`Webhook registered: ${webhookId} -> ${url}`);

            return ctx.json(
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
        })
        .openapi(listRoute, async (ctx) => {
            const webhooks = webhookSubscriber.getWebhooks().map((webhook) => ({
                id: webhook.id,
                url: webhook.url,
                description: webhook.description,
                createdAt: webhook.createdAt,
            }));

            return ctx.json({ webhooks });
        })
        .openapi(getRoute, (ctx) => {
            const { webhookId } = ctx.req.valid('param');
            const webhook = webhookSubscriber.getWebhook(webhookId);
            if (!webhook) {
                return ctx.json({ error: 'Webhook not found' }, 404);
            }

            return ctx.json({
                webhook: {
                    id: webhook.id,
                    url: webhook.url,
                    description: webhook.description,
                    createdAt: webhook.createdAt,
                },
            });
        })
        .openapi(deleteRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { webhookId } = ctx.req.valid('param');
            const removed = webhookSubscriber.removeWebhook(webhookId);
            if (!removed) {
                return ctx.json({ error: 'Webhook not found' }, 404);
            }
            agent.logger.info(`Webhook removed: ${webhookId}`);
            return ctx.json({ status: 'removed', webhookId });
        })
        .openapi(testRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { webhookId } = ctx.req.valid('param');
            const webhook = webhookSubscriber.getWebhook(webhookId);

            if (!webhook) {
                return ctx.json({ error: 'Webhook not found' }, 404);
            }

            agent.logger.info(`Testing webhook: ${webhookId}`);
            const result = await webhookSubscriber.testWebhook(webhookId);

            return ctx.json({
                test: 'completed',
                result: {
                    success: result.success,
                    statusCode: result.statusCode,
                    responseTime: result.responseTime,
                    error: result.error,
                },
            });
        });
}
