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
import { ApprovalCoordinator } from '../approval/approval-coordinator.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
    version: string;
};

// Dummy context for type inference and runtime fallback
// Used when running in single-agent mode (CLI, Docker, etc.) where multi-agent
// features aren't available. Agents router is always mounted for consistent API
// structure, but will return clear errors if multi-agent endpoints are called.
// This ensures type safety across different deployment modes.
const dummyAgentsContext: AgentsRouterContext = {
    switchAgentById: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    switchAgentByPath: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    resolveAgentInfo: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    ensureAgentAvailable: () => {},
    getActiveAgentId: () => undefined,
};

export type CreateDextoAppOptions = {
    apiPrefix?: string;
    getAgent: () => DextoAgent;
    getAgentCard: () => AgentCard;
    approvalCoordinator: ApprovalCoordinator;
    webhookSubscriber: WebhookEventSubscriber;
    sseSubscriber: A2ASseEventSubscriber;
    agentsContext?: AgentsRouterContext;
};

export function createDextoApp(options: CreateDextoAppOptions) {
    const {
        getAgent,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        agentsContext,
    } = options;
    const app = new OpenAPIHono({ strict: false });

    // Global CORS middleware for cross-origin requests (must be first)
    app.use('*', createCorsMiddleware());

    // Global authentication middleware (after CORS, before routes)
    app.use('*', createAuthMiddleware());

    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));

    // Apply middleware to all /api routes
    app.use('/api/*', prettyJsonMiddleware);
    app.use('/api/*', redactionMiddleware);

    // Mount all API routers directly at /api for proper type inference
    // Each router is mounted individually so Hono can properly track route types
    const fullApp = app
        .route('/health', createHealthRouter(getAgent))
        .route('/', createA2aRouter(getAgentCard))
        .route('/', createA2AJsonRpcRouter(getAgent, sseSubscriber))
        .route('/', createA2ATasksRouter(getAgent, sseSubscriber))
        .route('/api', createGreetingRouter(getAgent))
        .route('/api', createMessagesRouter(getAgent, approvalCoordinator))
        .route('/api', createLlmRouter(getAgent))
        .route('/api', createSessionsRouter(getAgent))
        .route('/api', createSearchRouter(getAgent))
        .route('/api', createMcpRouter(getAgent))
        .route('/api', createWebhooksRouter(getAgent, webhookSubscriber))
        .route('/api', createPromptsRouter(getAgent))
        .route('/api', createResourcesRouter(getAgent))
        .route('/api', createMemoryRouter(getAgent))
        .route('/api', createApprovalsRouter(getAgent, approvalCoordinator))
        .route('/api', createAgentsRouter(getAgent, agentsContext || dummyAgentsContext));

    // Expose OpenAPI document
    // Current approach uses @hono/zod-openapi's .doc() method for OpenAPI spec generation
    // Alternative: Use openAPIRouteHandler from hono-openapi (third-party) for auto-generation
    // Keeping current approach since:
    // 1. @hono/zod-openapi is official Hono package with first-class support
    // 2. We already generate spec via scripts/generate-openapi-spec.ts to docs/
    // 3. Switching would require adding hono-openapi dependency and migration effort
    // See: https://honohub.dev/docs/openapi/zod#generating-the-openapi-spec
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

    // NOTE: Subscribers and approval handler are wired in CLI layer before agent.start()
    // This ensures proper initialization order and validation
    // We attach webhookSubscriber as a property but don't include it in the return type
    // to preserve Hono's route type inference
    Object.assign(fullApp, { webhookSubscriber });

    return fullApp;
}

// Export inferred AppType
// Routes are now properly typed since they're all mounted directly
export type AppType = ReturnType<typeof createDextoApp>;
