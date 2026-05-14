/*
 * Service initializer: internal wiring for the Dexto core runtime.
 *
 * NOTE: During the DI refactor, config→instance resolution is migrating out of core into
 * `@dexto/agent-config`. This module should focus on orchestrating internal services and
 * allow host overrides where needed (tests, servers, CLI).
 */

import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import type { ToolPolicies } from '../tools/schemas.js';
import type { Tool } from '../tools/types.js';
import type { AllowedToolsProvider } from '../tools/approval/allowed-tools-provider/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import type { DextoStores } from '../storage/index.js';
import type { ToolExecutionStore } from '../storage/tool-executions/types.js';
import { AgentError } from '../agent/errors.js';
import { WorkspaceManager } from '../workspace/index.js';
import { createAllowedToolsProvider } from '../tools/approval/allowed-tools-provider/factory.js';
import type { Logger } from '../logger/v2/types.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { ApprovalManager } from '../approval/manager.js';
import { MemoryManager } from '../memory/index.js';
import { HookManager } from '../hooks/manager.js';
import type { Hook } from '../hooks/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { SessionToolPreferencesStore } from '../tools/session-tool-preferences-store.js';
import type { LanguageModelFactory } from '../llm/services/types.js';
import type { WorkspaceHandleProvider } from '../workspace/types.js';

/**
 * Type for the core agent services returned by createAgentServices
 */
export type AgentServices = {
    mcpManager: MCPManager;
    toolManager: ToolManager;
    systemPromptManager: SystemPromptManager;
    agentEventBus: AgentEventBus;
    stateManager: AgentStateManager;
    sessionManager: SessionManager;
    workspaceManager: WorkspaceManager;
    searchService: SearchService;
    stores: DextoStores;
    resourceManager: ResourceManager;
    approvalManager: ApprovalManager;
    memoryManager: MemoryManager;
    hookManager: HookManager;
};

export type ToolManagerFactoryOptions = {
    mcpManager: MCPManager;
    approvalManager: ApprovalManager;
    allowedToolsProvider: AllowedToolsProvider;
    approvalMode: 'manual' | 'auto-approve';
    agentEventBus: AgentEventBus;
    toolPolicies: ToolPolicies;
    tools: Tool[];
    logger: Logger;
    toolExecutionStore: ToolExecutionStore;
};

export type ToolManagerFactory = (options: ToolManagerFactoryOptions) => ToolManager;

export type ToolkitLoader = (toolkits: string[]) => Promise<Tool[]>;

export type TelemetryBootstrapContext = Readonly<{
    agentId: string;
    config: AgentRuntimeSettings['telemetry'];
    logger: Logger;
}>;

export type TelemetryBootstrap = (context: TelemetryBootstrapContext) => Promise<void> | void;

export type InitializeServicesOptions = {
    sessionLoggerFactory?: import('../session/session-manager.js').SessionLoggerFactory;
    languageModelFactory?: LanguageModelFactory;
    mcpAuthProviderFactory?: import('../mcp/types.js').McpAuthProviderFactory | null;
    toolManager?: ToolManager;
    toolManagerFactory?: ToolManagerFactory;
    stores?: DextoStores;
    hooks?: Hook[] | undefined;
    workspaceHandleProvider?: WorkspaceHandleProvider | undefined;
    telemetryBootstrap?: TelemetryBootstrap | undefined;
};

export async function initializeAgentTelemetry(
    config: AgentRuntimeSettings,
    logger: Logger,
    telemetryBootstrap?: TelemetryBootstrap | undefined
): Promise<void> {
    if (telemetryBootstrap) {
        await telemetryBootstrap({
            agentId: config.agentId,
            config: config.telemetry,
            logger,
        });
        return;
    }

    if (config.telemetry?.enabled) {
        const { Telemetry } = await import('../telemetry/telemetry.js');
        await Telemetry.init(config.telemetry);
        logger.debug('Telemetry initialized');
    }
}

// High-level factory to load, validate, and wire up all agent services in one call
/**
 * Initializes all agent services from a validated configuration.
 * @param config The validated agent configuration object
 * @param logger Logger instance for this agent (dependency injection)
 * @param agentEventBus Pre-created event bus from DextoAgent constructor
 * @param overrides Optional service overrides for customization (e.g., sessionLoggerFactory, languageModelFactory)
 * @returns All the initialized services required for a Dexto agent
 */
export async function createAgentServices(
    config: AgentRuntimeSettings,
    logger: Logger,
    agentEventBus: AgentEventBus,
    overrides?: InitializeServicesOptions,
    compactionStrategy?: CompactionStrategy | null | undefined
): Promise<AgentServices> {
    // 0. Initialize telemetry FIRST (before any decorated classes are instantiated)
    // This must happen before creating any services that use @InstrumentClass decorator
    await initializeAgentTelemetry(config, logger, overrides?.telemetryBootstrap);

    // 1. Use the event bus provided by DextoAgent constructor
    logger.debug('Using pre-created agent event bus');

    // 2. Initialize typed stores (config/image layers own backend resolution)
    logger.debug('Initializing typed stores');
    const stores =
        overrides?.stores ??
        (() => {
            throw AgentError.initializationFailed(
                'DextoStores must be provided via overrides.stores during the DI refactor'
            );
        })();

    if (!stores.isConnected()) {
        await stores.connect();
    }

    logger.debug('Typed stores initialized', { type: stores.getStoreType() });

    const sessionCacheTtlMs = config.sessions?.sessionTTL ?? 3600000;
    const approvalStore = stores.getStore('approvals');
    const sessionStore = stores.getStore('sessions');
    const conversationStore = stores.getStore('conversation');
    const sessionToolPreferencesStore = new SessionToolPreferencesStore(
        stores.getStore('toolPreferences'),
        logger,
        {
            cacheTtlMs: sessionCacheTtlMs,
        }
    );
    const steerQueueStore = stores.getStore('steerQueue');
    const followUpQueueStore = stores.getStore('followUpQueue');

    // 2.5 Initialize workspace manager (uses persistent database)
    const workspaceManager = new WorkspaceManager(
        stores.getStore('workspaces'),
        agentEventBus,
        logger,
        overrides?.workspaceHandleProvider
    );
    logger.debug('Workspace manager initialized');

    // 3. Initialize approval system (generalized user approval)
    // Created before MCP manager since MCP manager depends on it for elicitation support
    logger.debug('Initializing approval manager');
    const approvalManager = new ApprovalManager(
        {
            permissions: {
                mode: config.permissions.mode,
                ...(config.permissions.timeout !== undefined && {
                    timeout: config.permissions.timeout,
                }),
            },
            elicitation: {
                enabled: config.elicitation.enabled,
                ...(config.elicitation.timeout !== undefined && {
                    timeout: config.elicitation.timeout,
                }),
            },
        },
        logger,
        approvalStore
    );
    logger.debug('Approval system initialized');

    // 4. Initialize MCP manager
    const mcpManager = new MCPManager(logger, agentEventBus);
    if (overrides?.mcpAuthProviderFactory) {
        mcpManager.setAuthProviderFactory(overrides.mcpAuthProviderFactory);
    }
    await mcpManager.initializeFromConfig(config.mcpServers);

    // 4.1 - Wire approval manager into MCP manager for elicitation support
    mcpManager.setApprovalManager(approvalManager);
    logger.debug('Approval manager connected to MCP manager for elicitation support');

    // 5. Initialize search service
    const searchService = new SearchService(conversationStore, sessionStore, logger);

    // 6. Initialize memory manager
    const memoryManager = new MemoryManager(stores.getStore('memories'), logger);
    logger.debug('Memory manager initialized');

    // 6.5 Initialize hook manager
    const hooks = overrides?.hooks ?? [];
    const hookManager = new HookManager(
        {
            agentEventBus,
            stores,
        },
        hooks,
        logger
    );

    // Initialize hook manager (registers pre-resolved hooks to extension points)
    await hookManager.initialize();
    logger.info('Hook manager initialized');

    // 7. Initialize resource manager (MCP + internal resources)
    // Moved before tool manager so it can be passed to internal tools
    const resourceManager = new ResourceManager(
        mcpManager,
        {
            resourcesConfig: config.resources,
            artifactStore: stores.getStore('artifacts'),
        },
        agentEventBus,
        logger
    );
    await resourceManager.initialize();

    // 8. Initialize tool manager
    // 8.1 - Create allowed tools provider based on configuration
    const allowedToolsProvider = createAllowedToolsProvider(
        {
            type: config.permissions.allowedToolsStorage,
            toolPreferenceStore: stores.getStore('toolPreferences'),
        },
        logger
    );

    const toolManager =
        overrides?.toolManager ??
        overrides?.toolManagerFactory?.({
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            approvalMode: config.permissions.mode,
            agentEventBus,
            toolPolicies: config.permissions.toolPolicies,
            tools: [],
            logger,
            toolExecutionStore: stores.getStore('toolExecutions'),
        }) ??
        new ToolManager(
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            config.permissions.mode,
            agentEventBus,
            config.permissions.toolPolicies,
            [],
            logger,
            sessionToolPreferencesStore,
            stores.getStore('toolExecutions')
        );
    await toolManager.setWorkspaceManager(workspaceManager);
    // NOTE: local tools + ToolExecutionContext are wired in DextoAgent.start()

    const mcpServerCount = Object.keys(config.mcpServers).length;
    if (mcpServerCount === 0) {
        logger.info('Agent initialized without MCP servers - only built-in capabilities available');
    } else {
        logger.debug(`MCPManager initialized with ${mcpServerCount} MCP server(s)`);
    }

    // 9. Initialize prompt manager
    const systemPromptManager = new SystemPromptManager(
        config.systemPrompt,
        memoryManager,
        config.memories,
        logger
    );

    // 10. Initialize state manager for runtime state tracking
    const stateManager = new AgentStateManager(config, agentEventBus, logger);
    logger.debug('Agent state manager initialized');

    // 11. Initialize session manager
    const sessionManager = new SessionManager(
        {
            stateManager,
            systemPromptManager,
            toolManager,
            approvalManager,
            agentEventBus,
            sessionStore,
            conversationStore,
            resourceManager, // Add resource manager for blob storage
            hookManager, // Add hook manager for hook execution
            mcpManager, // Add MCP manager for ChatSession
            steerQueueStore,
            followUpQueueStore,
            compactionStrategy: compactionStrategy ?? null,
            workspaceManager, // Workspace context propagation
        },
        {
            maxSessions: config.sessions?.maxSessions,
            sessionTTL: config.sessions?.sessionTTL,
            ...(overrides?.sessionLoggerFactory !== undefined && {
                sessionLoggerFactory: overrides.sessionLoggerFactory,
            }),
            ...(overrides?.languageModelFactory !== undefined && {
                languageModelFactory: overrides.languageModelFactory,
            }),
        },
        logger
    );

    // Initialize the session manager with persistent storage
    await sessionManager.init();

    logger.debug('Session manager initialized with storage support');

    // 12.5 Wire up hook support to ToolManager (after SessionManager is created)
    toolManager.setHookSupport(hookManager, sessionManager, stateManager);
    logger.debug('Hook support connected to ToolManager');

    // 13. Return the core services
    return {
        mcpManager,
        toolManager,
        systemPromptManager,
        agentEventBus,
        stateManager,
        sessionManager,
        workspaceManager,
        searchService,
        stores,
        resourceManager,
        approvalManager,
        memoryManager,
        hookManager,
    };
}
