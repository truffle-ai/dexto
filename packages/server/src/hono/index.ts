import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, Hono } from 'hono';
import type { BlankEnv, ExtractSchema, MergeSchemaPath } from 'hono/types';
import type { Env, Schema } from 'hono/types';
import type { AgentCard } from '@dexto/core';
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
import { createWebhooksRouter, type WebhooksRouterSchema } from './routes/webhooks.js';
import { createPromptsRouter, type PromptsRouterSchema } from './routes/prompts.js';
import { createResourcesRouter, type ResourcesRouterSchema } from './routes/resources.js';
import { createMemoryRouter, type MemoryRouterSchema } from './routes/memory.js';
import { createWorkspacesRouter, type WorkspacesRouterSchema } from './routes/workspaces.js';
import { createSchedulesRouter, type SchedulesRouterSchema } from './routes/schedules.js';
import {
    createAgentsRouter,
    type AgentsRouterContext,
    type AgentsRouterSchema,
} from './routes/agents.js';
import { createApprovalsRouter, type ApprovalsRouterSchema } from './routes/approvals.js';
import { createQueueRouter, type QueueRouterSchema } from './routes/queue.js';
import { createOpenRouterRouter, type OpenRouterRouterSchema } from './routes/openrouter.js';
import { createKeyRouter, type KeyRouterSchema } from './routes/key.js';
import { createToolsRouter, type ToolsRouterSchema } from './routes/tools.js';
import { createDiscoveryRouter, type DiscoveryRouterSchema } from './routes/discovery.js';
import { createModelsRouter, type ModelsRouterSchema } from './routes/models.js';
import { createDextoAuthRouter, type DextoAuthRouterSchema } from './routes/dexto-auth.js';
import { createSystemPromptRouter, type SystemPromptRouterSchema } from './routes/system-prompt.js';
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
    | WebhooksRouterSchema
    | PromptsRouterSchema
    | ResourcesRouterSchema
    | MemoryRouterSchema
    | WorkspacesRouterSchema
    | SchedulesRouterSchema;

type ManagementRouterSchema = ApprovalsRouterSchema | AgentsRouterSchema | QueueRouterSchema;

type SystemRouterSchema =
    | OpenRouterRouterSchema
    | KeyRouterSchema
    | ToolsRouterSchema
    | DiscoveryRouterSchema
    | ModelsRouterSchema
    | SystemPromptRouterSchema
    | DextoAuthRouterSchema;

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

    // Keep route contracts in the route files themselves and avoid re-instantiating the entire
    // composed router graph during declaration emit. Hono tracks the exported AppType from the
    // explicit AppSchema above; erasing child router types here only affects this mount list.
    // See: https://github.com/honojs/hono/issues/2399
    const mountedRouters: Array<readonly [string, Hono<Env, Schema, string>]> = [
        ['/health', createHealthRouter(getAgent)],
        ['/', createA2aRouter(getAgentCard)],
        ['/', createA2AJsonRpcRouter(getAgent, sseSubscriber)],
        ['/', createA2ATasksRouter(getAgent, sseSubscriber)],
        [routePrefix, createGreetingRouter(getAgent)],
        [routePrefix, createMessagesRouter(getAgent, approvalCoordinator)],
        [routePrefix, createLlmRouter(getAgent)],
        [routePrefix, createSessionsRouter(getAgent)],
        [routePrefix, createSearchRouter(getAgent)],
        [routePrefix, createMcpRouter(getAgent, resolvedGetAgentConfigPath)],
        [routePrefix, createWebhooksRouter(getAgent, webhookSubscriber)],
        [routePrefix, createPromptsRouter(getAgent)],
        [routePrefix, createResourcesRouter(getAgent)],
        [routePrefix, createMemoryRouter(getAgent)],
        [routePrefix, createWorkspacesRouter(getAgent)],
        [routePrefix, createSchedulesRouter(getAgent)],
        [routePrefix, createApprovalsRouter(getAgent, approvalCoordinator)],
        [
            routePrefix,
            createAgentsRouter(
                getAgent,
                agentsContext || dummyAgentsContext,
                resolvedGetAgentConfigPath
            ),
        ],
        [routePrefix, createQueueRouter(getAgent)],
        [routePrefix, createOpenRouterRouter()],
        [routePrefix, createKeyRouter()],
        [routePrefix, createToolsRouter(getAgent)],
        [routePrefix, createDiscoveryRouter(resolvedGetAgentConfigPath)],
        [routePrefix, createModelsRouter()],
        [routePrefix, createSystemPromptRouter(getAgent)],
        [routePrefix, createDextoAuthRouter(getAgent)],
    ];

    for (const [path, router] of mountedRouters) {
        fullApp.route(path, router);
    }

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
