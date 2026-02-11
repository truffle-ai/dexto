import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { DextoAgent, AgentCard } from '@dexto/core';
import { logger } from '@dexto/core';
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
import { createQueueRouter } from './routes/queue.js';
import { createOpenRouterRouter } from './routes/openrouter.js';
import { createKeyRouter } from './routes/key.js';
import { createToolsRouter } from './routes/tools.js';
import { createDiscoveryRouter } from './routes/discovery.js';
import { createModelsRouter } from './routes/models.js';
import { createDextoAuthRouter } from './routes/dexto-auth.js';
import {
    createStaticRouter,
    createSpaFallbackHandler,
    type WebUIRuntimeConfig,
} from './routes/static.js';
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

// Type for async getAgent with context support
export type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;
export type GetAgentConfigPathFn = (
    ctx: Context
) => string | undefined | Promise<string | undefined>;

export type CreateDextoAppOptions = {
    /**
     * Prefix for API routes. Defaults to '/api'.
     */
    apiPrefix?: string;
    getAgent: GetAgentFn;
    /**
     * Optional active agent config path resolver.
     *
     * Used by file-based endpoints (e.g. /api/agent/config) for reading/writing YAML.
     * Host layers (CLI/server/platform) own config file paths; core does not.
     */
    getAgentConfigPath?: GetAgentConfigPathFn;
    getAgentCard: () => AgentCard;
    approvalCoordinator: ApprovalCoordinator;
    webhookSubscriber: WebhookEventSubscriber;
    sseSubscriber: A2ASseEventSubscriber;
    agentsContext?: AgentsRouterContext;
    /** Absolute path to WebUI build output. If provided, static files will be served. */
    webRoot?: string;
    /** Runtime configuration to inject into WebUI (analytics, etc.) */
    webUIConfig?: WebUIRuntimeConfig;
    /** Disable built-in auth middleware. Use when you have your own auth layer. */
    disableAuth?: boolean;
};

// Default API prefix as a const literal for type inference
const DEFAULT_API_PREFIX = '/api' as const;

export function createDextoApp(options: CreateDextoAppOptions) {
    const {
        apiPrefix,
        getAgent,
        getAgentConfigPath,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        agentsContext,
        webRoot,
        webUIConfig,
        disableAuth = false,
    } = options;

    // Security check: Warn when auth is disabled
    if (disableAuth) {
        logger.warn(
            `⚠️  Authentication disabled (disableAuth=true). createAuthMiddleware() skipped. Ensure external auth is in place.`
        );
    }

    const app = new OpenAPIHono({ strict: false });

    // Global CORS middleware for cross-origin requests (must be first)
    app.use('*', createCorsMiddleware());

    // Global authentication middleware (after CORS, before routes)
    // Can be disabled when using an external auth layer
    if (!disableAuth) {
        app.use('*', createAuthMiddleware());
    }

    // Global error handling for all routes
    app.onError((err, ctx) => handleHonoError(ctx, err));

    // Normalize prefix: strip trailing slashes, treat '' as '/'
    const rawPrefix = apiPrefix ?? DEFAULT_API_PREFIX;
    const normalizedPrefix = rawPrefix === '' ? '/' : rawPrefix.replace(/\/+$/, '') || '/';
    const middlewarePattern = normalizedPrefix === '/' ? '/*' : `${normalizedPrefix}/*`;

    app.use(middlewarePattern, prettyJsonMiddleware);
    app.use(middlewarePattern, redactionMiddleware);

    // Cast to literal type for RPC client type inference (webui uses default '/api')
    const routePrefix = normalizedPrefix as typeof DEFAULT_API_PREFIX;

    // Mount all API routers at the configured prefix for proper type inference
    // Each router is mounted individually so Hono can properly track route types
    const resolvedGetAgentConfigPath = getAgentConfigPath ?? ((_ctx: Context) => undefined);
    const fullApp = app
        // Public health endpoint
        .route('/health', createHealthRouter(getAgent))
        // Follows A2A discovery protocol
        .route('/', createA2aRouter(getAgentCard))
        .route('/', createA2AJsonRpcRouter(getAgent, sseSubscriber))
        .route('/', createA2ATasksRouter(getAgent, sseSubscriber))
        // Add agent-specific routes
        .route(routePrefix, createGreetingRouter(getAgent))
        .route(routePrefix, createMessagesRouter(getAgent, approvalCoordinator))
        .route(routePrefix, createLlmRouter(getAgent))
        .route(routePrefix, createSessionsRouter(getAgent))
        .route(routePrefix, createSearchRouter(getAgent))
        .route(routePrefix, createMcpRouter(getAgent, resolvedGetAgentConfigPath))
        .route(routePrefix, createWebhooksRouter(getAgent, webhookSubscriber))
        .route(routePrefix, createPromptsRouter(getAgent))
        .route(routePrefix, createResourcesRouter(getAgent))
        .route(routePrefix, createMemoryRouter(getAgent))
        .route(routePrefix, createApprovalsRouter(getAgent, approvalCoordinator))
        .route(
            routePrefix,
            createAgentsRouter(
                getAgent,
                agentsContext || dummyAgentsContext,
                resolvedGetAgentConfigPath
            )
        )
        .route(routePrefix, createQueueRouter(getAgent))
        .route(routePrefix, createOpenRouterRouter())
        .route(routePrefix, createKeyRouter())
        .route(routePrefix, createToolsRouter(getAgent))
        .route(routePrefix, createDiscoveryRouter(resolvedGetAgentConfigPath))
        .route(routePrefix, createModelsRouter())
        .route(routePrefix, createDextoAuthRouter(getAgent));

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
            {
                name: 'queue',
                description: 'Manage message queue for busy sessions',
            },
            {
                name: 'openrouter',
                description: 'OpenRouter model validation and cache management',
            },
            {
                name: 'discovery',
                description: 'Discover available providers and capabilities',
            },
            {
                name: 'tools',
                description:
                    'List and inspect available tools from internal, custom, and MCP sources',
            },
            {
                name: 'models',
                description: 'List and manage local GGUF models and Ollama models',
            },
            {
                name: 'auth',
                description: 'Dexto authentication status and management',
            },
        ],
    });

    // Mount static file router for WebUI if webRoot is provided
    if (webRoot) {
        fullApp.route('/', createStaticRouter(webRoot));
        // SPA fallback: serve index.html for unmatched routes without file extensions
        // Must be registered as notFound handler so it runs AFTER all routes (including /openapi.json)
        // webUIConfig is injected into index.html for runtime configuration (analytics, etc.)
        fullApp.notFound(createSpaFallbackHandler(webRoot, webUIConfig));
    }

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

// Re-export types needed by CLI
export type { WebUIRuntimeConfig } from './routes/static.js';
