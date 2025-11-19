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
import { createA2AJsonRpcRouter } from './routes/a2a-jsonrpc.js';
import { createA2ATasksRouter } from './routes/a2a-tasks.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createPromptsRouter } from './routes/prompts.js';
import { createResourcesRouter } from './routes/resources.js';
import { createMemoryRouter } from './routes/memory.js';
import { createAgentsRouter, type AgentsRouterContext } from './routes/agents.js';
import { createApprovalsRouter } from './routes/approvals.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { A2ASseEventSubscriber } from '../events/a2a-sse-subscriber.js';
import { handleHonoError } from './middleware/error.js';
import { prettyJsonMiddleware, redactionMiddleware } from './middleware/redaction.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { MessageStreamManager } from '../streams/message-stream-manager.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
    version: string;
};

// Dummy context for type inference and runtime fallback
const dummyAgentsContext: AgentsRouterContext = {
    switchAgentById: async () => {
        throw new Error('Not implemented');
    },
    switchAgentByPath: async () => {
        throw new Error('Not implemented');
    },
    resolveAgentInfo: async () => {
        throw new Error('Not implemented');
    },
    ensureAgentAvailable: () => {},
    getActiveAgentId: () => undefined,
};

export type CreateDextoAppOptions = {
    apiPrefix?: string;
    getAgent: () => DextoAgent;
    getAgentCard: () => AgentCard;
    messageStreamManager: MessageStreamManager;
    webhookSubscriber: WebhookEventSubscriber;
    sseSubscriber: A2ASseEventSubscriber;
    agentsContext?: AgentsRouterContext;
};

export function createDextoApp(options: CreateDextoAppOptions) {
    const {
        getAgent,
        getAgentCard,
        messageStreamManager,
        webhookSubscriber,
        sseSubscriber,
        agentsContext,
    } = options;
    const app = new OpenAPIHono({ strict: false }) as DextoApp;

    // NOTE: Subscribers and approval handler are wired in CLI layer before agent.start()
    // This ensures proper initialization order and validation
    app.webhookSubscriber = webhookSubscriber;

    // Global CORS middleware for cross-origin requests (must be first)
    app.use('*', createCorsMiddleware());

    // Global authentication middleware (after CORS, before routes)
    app.use('*', createAuthMiddleware());

    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));

    // Create API router using fluent chaining to ensure correct type inference
    const api = new OpenAPIHono()
        .use('*', prettyJsonMiddleware)
        .use('*', redactionMiddleware)
        .route('/', createGreetingRouter(getAgent))
        .route('/', createMessagesRouter(getAgent, messageStreamManager))
        .route('/', createLlmRouter(getAgent))
        .route('/', createSessionsRouter(getAgent))
        .route('/', createSearchRouter(getAgent))
        .route('/', createMcpRouter(getAgent))
        .route('/', createWebhooksRouter(getAgent, webhookSubscriber))
        .route('/', createPromptsRouter(getAgent))
        .route('/', createResourcesRouter(getAgent))
        .route('/', createMemoryRouter(getAgent))
        .route('/', createApprovalsRouter(getAgent, messageStreamManager))
        // Always mount agents router for consistent type signature
        // Use dummy context if real context is missing
        .route('/', createAgentsRouter(getAgent, agentsContext || dummyAgentsContext));

    // Construct the full application
    const fullApp = app
        .route('/health', createHealthRouter(getAgent))
        .route('/', createA2aRouter(getAgentCard))
        .route('/', createA2AJsonRpcRouter(getAgent, sseSubscriber))
        .route('/', createA2ATasksRouter(getAgent, sseSubscriber))
        .route(options.apiPrefix ?? '/api', api);

    // Expose OpenAPI document
    // TODO: check if we should use import { openAPIRouteHandler } from "hono-openapi"; - https://honohub.dev/docs/openapi/zod#generating-the-openapi-spec
    fullApp.doc('/openapi.json', {
        openapi: '3.0.0',
        info: {
            title: 'Dexto API',
            version: packageJson.version,
            description: 'OpenAPI spec for the Dexto REST API server',
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Local development server (default port)',
            },
            {
                url: 'http://localhost:{port}',
                description: 'Local development server (custom port)',
                variables: {
                    port: {
                        default: '3001',
                        description: 'API server port',
                    },
                },
            },
        ],
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
                name: 'agent',
                description: 'Current agent configuration and file operations',
            },
            {
                name: 'agents',
                description: 'Install, switch, and manage agent configurations',
            },
        ],
    });

    return fullApp;
}

// Export inferred AppType
export type AppType = ReturnType<typeof createDextoApp>;
