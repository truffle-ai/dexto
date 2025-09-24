import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { DextoAgent, AgentCard } from '@dexto/core';
import { createHealthRouter } from './routes/health.js';
import { createConfigRouter } from './routes/config.js';
import { createMessagesRouter } from './routes/messages.js';
import { createLlmRouter } from './routes/llm.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createSearchRouter } from './routes/search.js';
import { createMcpRouter } from './routes/mcp.js';
import { createA2aRouter } from './routes/a2a.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { handleHonoError } from './middleware/error.js';

export type CreateDextoAppOptions = {
    apiPrefix?: string;
    agentCard?: AgentCard;
};

type DextoApp = OpenAPIHono & { webhookSubscriber?: WebhookEventSubscriber };

export function createDextoApp(agent: DextoAgent, options: CreateDextoAppOptions = {}) {
    const app = new OpenAPIHono({ strict: false }) as DextoApp;
    const webhookSubscriber = new WebhookEventSubscriber();
    webhookSubscriber.subscribe(agent.agentEventBus);
    app.webhookSubscriber = webhookSubscriber;
    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));
    app.route('/health', createHealthRouter(agent));

    if (options.agentCard) {
        app.route('/', createA2aRouter(options.agentCard));
    }

    const api = new OpenAPIHono();
    api.route('/', createConfigRouter(agent));
    api.route('/', createMessagesRouter(agent));
    api.route('/', createLlmRouter(agent));
    api.route('/', createSessionsRouter(agent));
    api.route('/', createSearchRouter(agent));
    api.route('/', createMcpRouter(agent));
    api.route('/', createWebhooksRouter(agent, webhookSubscriber));

    // Apply prefix to all API routes if provided
    const apiPrefix = options.apiPrefix ?? '/api';
    app.route(apiPrefix, api);

    // Expose OpenAPI document at the root path for the entire app
    app.doc('/openapi.json', {
        openapi: '3.0.0',
        info: {
            title: 'Dexto API',
            version: '1.0.0',
            description: 'OpenAPI spec for the Dexto Hono server',
        },
    });

    return app;
}
