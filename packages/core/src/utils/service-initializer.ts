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
import type { AllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import { StorageManager } from '../storage/index.js';
import { AgentError } from '../agent/errors.js';
import { WorkspaceManager } from '../workspace/index.js';
import { createAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/factory.js';
import type { Logger } from '../logger/v2/types.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { ApprovalManager } from '../approval/manager.js';
import { MemoryManager } from '../memory/index.js';
import { HookManager } from '../hooks/manager.js';
import type { Hook } from '../hooks/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';

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
    storageManager: StorageManager;
    resourceManager: ResourceManager;
    approvalManager: ApprovalManager;
    memoryManager: MemoryManager;
    hookManager: HookManager;
};

export type ToolManagerFactoryOptions = {
    mcpManager: MCPManager;
    approvalManager: ApprovalManager;
    allowedToolsProvider: AllowedToolsProvider;
    approvalMode: 'manual' | 'auto-approve' | 'auto-deny';
    agentEventBus: AgentEventBus;
    toolPolicies: ToolPolicies;
    tools: Tool[];
    logger: Logger;
};

export type ToolManagerFactory = (options: ToolManagerFactoryOptions) => ToolManager;

export type ToolkitLoader = (toolkits: string[]) => Promise<Tool[]>;

export type InitializeServicesOptions = {
    sessionLoggerFactory?: import('../session/session-manager.js').SessionLoggerFactory;
    mcpAuthProviderFactory?: import('../mcp/types.js').McpAuthProviderFactory | null;
    toolManager?: ToolManager;
    toolManagerFactory?: ToolManagerFactory;
    storageManager?: StorageManager;
    hooks?: Hook[] | undefined;
    toolkitLoader?: ToolkitLoader;
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
    config: AgentRuntimeSettings,
    logger: Logger,
    agentEventBus: AgentEventBus,
    overrides?: InitializeServicesOptions,
    compactionStrategy?: CompactionStrategy | null | undefined
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

    // 2.5 Initialize workspace manager (uses persistent database)
    const workspaceManager = new WorkspaceManager(
        storageManager.getDatabase(),
        agentEventBus,
        logger
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
        logger
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
    const searchService = new SearchService(storageManager.getDatabase(), logger);

    // 6. Initialize memory manager
    const memoryManager = new MemoryManager(storageManager.getDatabase(), logger);
    logger.debug('Memory manager initialized');

    // 6.5 Initialize hook manager
    const hooks = overrides?.hooks ?? [];
    const hookManager = new HookManager(
        {
            agentEventBus,
            storageManager,
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
            blobStore: storageManager.getBlobStore(),
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
            approvalMode: config.permissions.mode,
            agentEventBus,
            toolPolicies: config.permissions.toolPolicies,
            tools: [],
            logger,
        }) ??
        new ToolManager(
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            config.permissions.mode,
            agentEventBus,
            config.permissions.toolPolicies,
            [],
            logger
        );
    toolManager.setWorkspaceManager(workspaceManager);
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
            agentEventBus,
            storageManager, // Add storage manager to session services
            resourceManager, // Add resource manager for blob storage
            hookManager, // Add hook manager for hook execution
            mcpManager, // Add MCP manager for ChatSession
            compactionStrategy: compactionStrategy ?? null,
            workspaceManager, // Workspace context propagation
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
        storageManager,
        resourceManager,
        approvalManager,
        memoryManager,
        hookManager,
    };
}
