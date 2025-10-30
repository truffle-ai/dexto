import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { DextoAgent, AgentCard } from '@dexto/core';
import type { DextoApp } from './types.js';
import { createHealthRouter } from './routes/health.js';
import { createGreetingRouter } from './routes/greeting.js';
import { createMessagesRouter } from './routes/messages.js';
import { createLlmRouter } from './routes/llm.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createSearchRouter } from './routes/search.js';
import { createMcpRouter } from './routes/mcp.js';
import { createA2aRouter } from './routes/a2a.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createPromptsRouter } from './routes/prompts.js';
import { createResourcesRouter } from './routes/resources.js';
import { createMemoryRouter } from './routes/memory.js';
import { createAgentsRouter } from './routes/agents.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { handleHonoError } from './middleware/error.js';
import { prettyJsonMiddleware, redactionMiddleware } from './middleware/redaction.js';

export type CreateDextoAppOptions = {
    apiPrefix?: string;
    getAgent: () => DextoAgent;
    getAgentCard: () => AgentCard;
    agentsContext?: {
        switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
        switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
        resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
        ensureAgentAvailable: () => void;
        getActiveAgentId: () => string | undefined;
    };
};

export function createDextoApp(options: CreateDextoAppOptions): DextoApp {
    const { getAgent, getAgentCard, agentsContext } = options;
    const app = new OpenAPIHono({ strict: false }) as DextoApp;
    const webhookSubscriber = new WebhookEventSubscriber();

    // Subscribe to agent's event bus (will be updated when agent switches)
    const agent = getAgent();
    webhookSubscriber.subscribe(agent.agentEventBus);
    app.webhookSubscriber = webhookSubscriber;

    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));
    app.route('/health', createHealthRouter(getAgent));

    // A2A routes use getter for agent card (updated on agent switch)
    app.route('/', createA2aRouter(getAgentCard));

    const api = new OpenAPIHono();
    api.use('*', prettyJsonMiddleware);
    api.use('*', redactionMiddleware);
    api.route('/', createGreetingRouter(getAgent));
    api.route('/', createMessagesRouter(getAgent));
    api.route('/', createLlmRouter(getAgent));
    api.route('/', createSessionsRouter(getAgent));
    api.route('/', createSearchRouter(getAgent));
    api.route('/', createMcpRouter(getAgent));
    api.route('/', createWebhooksRouter(getAgent, webhookSubscriber));
    api.route('/', createPromptsRouter(getAgent));
    api.route('/', createResourcesRouter(getAgent));
    api.route('/', createMemoryRouter(getAgent));

    // Add agents router if context is provided
    if (agentsContext) {
        api.route('/', createAgentsRouter(getAgent, agentsContext));
    }

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
