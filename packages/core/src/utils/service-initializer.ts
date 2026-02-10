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
import type { InternalTool } from '../tools/types.js';
import type { IAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import { StorageManager } from '../storage/index.js';
import { AgentError } from '../agent/errors.js';
import { createAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/factory.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { AgentRuntimeConfig } from '@core/agent/runtime-config.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { ApprovalManager } from '../approval/manager.js';
import { MemoryManager } from '../memory/index.js';
import { PluginManager } from '../plugins/manager.js';
import { resolveLocalPluginsFromConfig } from '../agent/resolve-local-plugins.js';
import type { DextoPlugin } from '../plugins/types.js';

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
    searchService: SearchService;
    storageManager: StorageManager;
    resourceManager: ResourceManager;
    approvalManager: ApprovalManager;
    memoryManager: MemoryManager;
    pluginManager: PluginManager;
};

export type ToolManagerFactoryOptions = {
    mcpManager: MCPManager;
    approvalManager: ApprovalManager;
    allowedToolsProvider: IAllowedToolsProvider;
    approvalMode: 'manual' | 'auto-approve' | 'auto-deny';
    agentEventBus: AgentEventBus;
    toolPolicies: ToolPolicies;
    tools: InternalTool[];
    logger: IDextoLogger;
};

export type ToolManagerFactory = (options: ToolManagerFactoryOptions) => ToolManager;

export type InitializeServicesOptions = {
    sessionLoggerFactory?: import('../session/session-manager.js').SessionLoggerFactory;
    mcpAuthProviderFactory?: import('../mcp/types.js').McpAuthProviderFactory | null;
    toolManager?: ToolManager;
    toolManagerFactory?: ToolManagerFactory;
    storageManager?: StorageManager;
    // TODO: temporary glue code to be removed/verified (remove-by: 4.1)
    plugins?: DextoPlugin[] | undefined;
};

// High-level factory to load, validate, and wire up all agent services in one call
/**
 * Initializes all agent services from a validated configuration.
 * @param config The validated agent configuration object
 * @param logger Logger instance for this agent (dependency injection)
 * @param agentEventBus Pre-created event bus from DextoAgent constructor
 * @param overrides Optional service overrides for customization (e.g., sessionLoggerFactory)
 * @returns All the initialized services required for a Dexto agent
 */
export async function createAgentServices(
    config: AgentRuntimeConfig,
    logger: IDextoLogger,
    agentEventBus: AgentEventBus,
    overrides?: InitializeServicesOptions
): Promise<AgentServices> {
    // 0. Initialize telemetry FIRST (before any decorated classes are instantiated)
    // This must happen before creating any services that use @InstrumentClass decorator
    if (config.telemetry?.enabled) {
        const { Telemetry } = await import('../telemetry/telemetry.js');
        await Telemetry.init(config.telemetry);
        logger.debug('Telemetry initialized');
    }

    // 1. Use the event bus provided by DextoAgent constructor
    logger.debug('Using pre-created agent event bus');

    // 2. Initialize storage manager (schema provides in-memory defaults, CLI enrichment adds filesystem paths)
    logger.debug('Initializing storage manager');
    const storageManager =
        overrides?.storageManager ??
        (() => {
            throw AgentError.initializationFailed(
                'StorageManager must be provided via overrides.storageManager during the DI refactor'
            );
        })();

    if (!storageManager.isConnected()) {
        await storageManager.initialize();
        await storageManager.connect();
    }

    logger.debug('Storage manager initialized', await storageManager.getInfo());

    // 3. Initialize approval system (generalized user approval)
    // Created before MCP manager since MCP manager depends on it for elicitation support
    logger.debug('Initializing approval manager');
    const approvalManager = new ApprovalManager(
        {
            toolConfirmation: {
                mode: config.toolConfirmation.mode,
                ...(config.toolConfirmation.timeout !== undefined && {
                    timeout: config.toolConfirmation.timeout,
                }),
            },
            elicitation: {
                enabled: config.elicitation.enabled,
                ...(config.elicitation.timeout !== undefined && {
                    timeout: config.elicitation.timeout,
                }),
            },
        },
        logger
    );
    logger.debug('Approval system initialized');

    // 4. Initialize MCP manager
    const mcpManager = new MCPManager(logger);
    if (overrides?.mcpAuthProviderFactory) {
        mcpManager.setAuthProviderFactory(overrides.mcpAuthProviderFactory);
    }
    await mcpManager.initializeFromConfig(config.mcpServers);

    // 4.1 - Wire approval manager into MCP manager for elicitation support
    mcpManager.setApprovalManager(approvalManager);
    logger.debug('Approval manager connected to MCP manager for elicitation support');

    // 5. Initialize search service
    const searchService = new SearchService(storageManager.getDatabase(), logger);

    // 6. Initialize memory manager
    const memoryManager = new MemoryManager(storageManager.getDatabase(), logger);
    logger.debug('Memory manager initialized');

    // 6.5 Initialize plugin manager
    const plugins = overrides?.plugins ?? (await resolveLocalPluginsFromConfig({ config, logger }));
    const pluginManager = new PluginManager(
        {
            agentEventBus,
            storageManager,
        },
        plugins,
        logger
    );

    // Initialize plugin manager (registers pre-resolved plugins to extension points)
    await pluginManager.initialize();
    logger.info('Plugin manager initialized');

    // 7. Initialize resource manager (MCP + internal resources)
    // Moved before tool manager so it can be passed to internal tools
    const resourceManager = new ResourceManager(
        mcpManager,
        {
            internalResourcesConfig: config.internalResources,
            blobStore: storageManager.getBlobStore(),
        },
        logger
    );
    await resourceManager.initialize();

    // 8. Initialize tool manager
    // 8.1 - Create allowed tools provider based on configuration
    const allowedToolsProvider = createAllowedToolsProvider(
        {
            type: config.toolConfirmation.allowedToolsStorage,
            storageManager,
        },
        logger
    );

    const toolManager =
        overrides?.toolManager ??
        overrides?.toolManagerFactory?.({
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            approvalMode: config.toolConfirmation.mode,
            agentEventBus,
            toolPolicies: config.toolConfirmation.toolPolicies,
            tools: [],
            logger,
        }) ??
        new ToolManager(
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            config.toolConfirmation.mode,
            agentEventBus,
            config.toolConfirmation.toolPolicies,
            [],
            logger
        );
    // NOTE: local tools + ToolExecutionContext are wired in DextoAgent.start()

    const mcpServerCount = Object.keys(config.mcpServers).length;
    if (mcpServerCount === 0) {
        logger.info('Agent initialized without MCP servers - only built-in capabilities available');
    } else {
        logger.debug(`MCPManager initialized with ${mcpServerCount} MCP server(s)`);
    }

    const enabledToolTypes = (config.tools ?? [])
        .filter((t) => t.enabled !== false)
        .map((t) => t.type);
    if (enabledToolTypes.length === 0) {
        logger.info('No tools enabled by configuration');
    } else {
        logger.info(`Tools enabled: ${enabledToolTypes.join(', ')}`);
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
            agentEventBus,
            storageManager, // Add storage manager to session services
            resourceManager, // Add resource manager for blob storage
            pluginManager, // Add plugin manager for plugin execution
            mcpManager, // Add MCP manager for ChatSession
        },
        {
            maxSessions: config.sessions?.maxSessions,
            sessionTTL: config.sessions?.sessionTTL,
            ...(overrides?.sessionLoggerFactory !== undefined && {
                sessionLoggerFactory: overrides.sessionLoggerFactory,
            }),
        },
        logger
    );

    // Initialize the session manager with persistent storage
    await sessionManager.init();

    logger.debug('Session manager initialized with storage support');

    // 12.5 Wire up plugin support to ToolManager (after SessionManager is created)
    toolManager.setPluginSupport(pluginManager, sessionManager, stateManager);
    logger.debug('Plugin support connected to ToolManager');

    // 13. Return the core services
    return {
        mcpManager,
        toolManager,
        systemPromptManager,
        agentEventBus,
        stateManager,
        sessionManager,
        searchService,
        storageManager,
        resourceManager,
        approvalManager,
        memoryManager,
        pluginManager,
    };
}
