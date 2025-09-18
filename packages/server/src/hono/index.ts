import { Hono } from 'hono';
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

type DextoApp = Hono & { webhookSubscriber?: WebhookEventSubscriber };

export function createDextoApp(agent: DextoAgent, options: CreateDextoAppOptions = {}) {
    const app = new Hono({ strict: false }) as DextoApp;
    const webhookSubscriber = new WebhookEventSubscriber();
    webhookSubscriber.subscribe(agent.agentEventBus);
    app.webhookSubscriber = webhookSubscriber;
    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));

    app.route('/health', createHealthRouter(agent));

    if (options.agentCard) {
        app.route('/', createA2aRouter(options.agentCard));
    }

    const apiPrefix = options.apiPrefix ?? '/api';
    const api = new Hono();
    api.route('/', createConfigRouter(agent));
    api.route('/', createMessagesRouter(agent));
    api.route('/', createLlmRouter(agent));
    api.route('/', createSessionsRouter(agent));
    api.route('/', createSearchRouter(agent));
    api.route('/', createMcpRouter(agent));
    api.route('/', createWebhooksRouter(agent, webhookSubscriber));

    app.route(apiPrefix, api);

    return app;
}
