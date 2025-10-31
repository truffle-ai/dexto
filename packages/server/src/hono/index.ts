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
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';

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

    // Global CORS middleware for cross-origin requests (must be first)
    app.use('*', createCorsMiddleware());

    // Global authentication middleware (after CORS, before routes)
    app.use('*', createAuthMiddleware());

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
        tags: [
            {
                name: 'system',
                description: 'System health and status endpoints',
            },
            {
                name: 'config',
                description: 'Agent configuration and greeting management',
            },
            {
                name: 'messages',
                description: 'Send messages to the agent and manage conversations',
            },
            {
                name: 'sessions',
                description: 'Create and manage conversation sessions',
            },
            {
                name: 'llm',
                description: 'Configure and switch between LLM providers and models',
            },
            {
                name: 'mcp',
                description: 'Manage Model Context Protocol (MCP) servers and tools',
            },
            {
                name: 'webhooks',
                description: 'Register and manage webhook endpoints for agent events',
            },
            {
                name: 'search',
                description: 'Search through messages and sessions',
            },
            {
                name: 'memory',
                description: 'Store and retrieve agent memories for context',
            },
            {
                name: 'prompts',
                description: 'Manage custom prompts and templates',
            },
            {
                name: 'resources',
                description: 'Access and manage resources from MCP servers and internal providers',
            },
            {
                name: 'agents',
                description: 'Install, switch, and manage agent configurations',
            },
        ],
    });

    return app;
}
