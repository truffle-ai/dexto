import type { OpenAPIHono } from '@hono/zod-openapi';
import type { WebhookEventSubscriber } from '../events/webhook-subscriber.js';

export type DextoApp = OpenAPIHono & {
    webhookSubscriber?: WebhookEventSubscriber;
};
