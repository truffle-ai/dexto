import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, Hono } from 'hono';
import type { BlankEnv, ExtractSchema, MergeSchemaPath } from 'hono/types';
import type { DextoAgent, AgentCard } from '@dexto/core';
import { logger } from '@dexto/core';
import { getDextoPackageRoot } from '@dexto/agent-management';
import { createHealthRouter } from './routes/health.js';
import { createGreetingRouter, type GreetingRouterSchema } from './routes/greeting.js';
import { createMessagesRouter, type MessagesRouterSchema } from './routes/messages.js';
import { createLlmRouter, type LlmRouterSchema } from './routes/llm.js';
import { createSessionsRouter, type SessionsRouterSchema } from './routes/sessions.js';
import { createSearchRouter, type SearchRouterSchema } from './routes/search.js';
import { createMcpRouter, type McpRouterSchema } from './routes/mcp.js';
import { createA2aRouter } from './routes/a2a.js';
import { createA2AJsonRpcRouter } from './routes/a2a-jsonrpc.js';
import { createA2ATasksRouter } from './routes/a2a-tasks.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createPromptsRouter } from './routes/prompts.js';
import { createResourcesRouter } from './routes/resources.js';
import { createMemoryRouter } from './routes/memory.js';
import { createWorkspacesRouter } from './routes/workspaces.js';
import { createSchedulesRouter } from './routes/schedules.js';
import { createAgentsRouter, type AgentsRouterContext } from './routes/agents.js';
import { createApprovalsRouter } from './routes/approvals.js';
import { createQueueRouter } from './routes/queue.js';
import { createOpenRouterRouter } from './routes/openrouter.js';
import { createKeyRouter } from './routes/key.js';
import { createToolsRouter } from './routes/tools.js';
import { createDiscoveryRouter } from './routes/discovery.js';
import { createModelsRouter } from './routes/models.js';
import { createDextoAuthRouter } from './routes/dexto-auth.js';
import { createSystemPromptRouter } from './routes/system-prompt.js';
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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DextoApp, GetAgentConfigPathFn, GetAgentFn } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPackageVersion(packageJsonPath: string): string | undefined {
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content) as { version?: unknown };
        if (typeof packageJson.version === 'string' && packageJson.version.length > 0) {
            return packageJson.version;
        }
    } catch {
        // Ignore parse/read errors and use fallback.
    }

    return undefined;
}

function resolveServerVersion(): string {
    const localVersion = readPackageVersion(join(__dirname, '../../package.json'));
    if (localVersion) {
        return localVersion;
    }

    const packageRoot = getDextoPackageRoot();
    if (packageRoot) {
        const standaloneVersion = readPackageVersion(join(packageRoot, 'package.json'));
        if (standaloneVersion) {
            return standaloneVersion;
        }
    }

    return process.env.DEXTO_CLI_VERSION ?? '0.0.0';
}

const serverVersion = resolveServerVersion();

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

type HealthSchema = MergeSchemaPath<
    ExtractSchema<ReturnType<typeof createHealthRouter>>,
    '/health'
>;
type DiscoverySchema = MergeSchemaPath<ExtractSchema<ReturnType<typeof createA2aRouter>>, '/'>;
type JsonRpcSchema = MergeSchemaPath<ExtractSchema<ReturnType<typeof createA2AJsonRpcRouter>>, '/'>;

type ConversationRouterSchema =
    | GreetingRouterSchema
    | MessagesRouterSchema
    | LlmRouterSchema
    | SessionsRouterSchema
    | SearchRouterSchema;

type IntegrationRouterSchema =
    | McpRouterSchema
    | ExtractSchema<ReturnType<typeof createWebhooksRouter>>
    | ExtractSchema<ReturnType<typeof createPromptsRouter>>
    | ExtractSchema<ReturnType<typeof createResourcesRouter>>
    | ExtractSchema<ReturnType<typeof createMemoryRouter>>
    | ExtractSchema<ReturnType<typeof createWorkspacesRouter>>
    | ExtractSchema<ReturnType<typeof createSchedulesRouter>>;

type ManagementRouterSchema =
    | ExtractSchema<ReturnType<typeof createApprovalsRouter>>
    | ExtractSchema<ReturnType<typeof createAgentsRouter>>
    | ExtractSchema<ReturnType<typeof createQueueRouter>>;

type SystemRouterSchema =
    | ExtractSchema<ReturnType<typeof createOpenRouterRouter>>
    | ExtractSchema<ReturnType<typeof createKeyRouter>>
    | ExtractSchema<ReturnType<typeof createToolsRouter>>
    | ExtractSchema<ReturnType<typeof createDiscoveryRouter>>
    | ExtractSchema<ReturnType<typeof createModelsRouter>>
    | ExtractSchema<ReturnType<typeof createSystemPromptRouter>>
    | ExtractSchema<ReturnType<typeof createDextoAuthRouter>>;

type DefaultApiRouterSchema =
    | ConversationRouterSchema
    | IntegrationRouterSchema
    | ManagementRouterSchema
    | SystemRouterSchema;

type DefaultApiSchema = MergeSchemaPath<DefaultApiRouterSchema, typeof DEFAULT_API_PREFIX>;

// Keep the protocol-style A2A tasks routes out of the exported client type surface for now.
// They still exist at runtime and in OpenAPI docs, but including them here triggers TS2589 in
// declaration emit for the entire server package. Track narrowing/follow-up against:
// https://github.com/honojs/hono/issues/2399
type PublicApiSchema = HealthSchema | DiscoverySchema | JsonRpcSchema;
type AppSchema = PublicApiSchema | DefaultApiSchema;

export function createDextoApp(options: CreateDextoAppOptions): DextoApp {
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
    const fullApp: DextoApp = app;

    fullApp.route('/health', createHealthRouter(getAgent));
    fullApp.route('/', createA2aRouter(getAgentCard));
    fullApp.route('/', createA2AJsonRpcRouter(getAgent, sseSubscriber));
    fullApp.route('/', createA2ATasksRouter(getAgent, sseSubscriber));
    fullApp.route(routePrefix, createGreetingRouter(getAgent));
    fullApp.route(routePrefix, createMessagesRouter(getAgent, approvalCoordinator));
    fullApp.route(routePrefix, createLlmRouter(getAgent));
    fullApp.route(routePrefix, createSessionsRouter(getAgent));
    fullApp.route(routePrefix, createSearchRouter(getAgent));
    fullApp.route(routePrefix, createMcpRouter(getAgent, resolvedGetAgentConfigPath));
    fullApp.route(routePrefix, createWebhooksRouter(getAgent, webhookSubscriber));
    fullApp.route(routePrefix, createPromptsRouter(getAgent));
    fullApp.route(routePrefix, createResourcesRouter(getAgent));
    fullApp.route(routePrefix, createMemoryRouter(getAgent));
    fullApp.route(routePrefix, createWorkspacesRouter(getAgent));
    fullApp.route(routePrefix, createSchedulesRouter(getAgent));
    fullApp.route(routePrefix, createApprovalsRouter(getAgent, approvalCoordinator));
    fullApp.route(
        routePrefix,
        createAgentsRouter(
            getAgent,
            agentsContext || dummyAgentsContext,
            resolvedGetAgentConfigPath
        )
    );
    fullApp.route(routePrefix, createQueueRouter(getAgent));
    fullApp.route(routePrefix, createOpenRouterRouter());
    fullApp.route(routePrefix, createKeyRouter());
    fullApp.route(routePrefix, createToolsRouter(getAgent));
    fullApp.route(routePrefix, createDiscoveryRouter(resolvedGetAgentConfigPath));
    fullApp.route(routePrefix, createModelsRouter());
    fullApp.route(routePrefix, createSystemPromptRouter(getAgent));
    fullApp.route(routePrefix, createDextoAuthRouter(getAgent));

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
            version: serverVersion,
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
                name: 'schedules',
                description: 'Create and manage automation schedules',
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
                description: 'List and inspect available tools from local and MCP sources',
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

export type AppType = Hono<BlankEnv, AppSchema, '/'>;

// Re-export types needed by CLI
export type { WebUIRuntimeConfig } from './routes/static.js';
