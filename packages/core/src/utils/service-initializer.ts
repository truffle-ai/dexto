/*
 * Service Initializer: Centralized Wiring for Dexto Core Services
 *
 * This module is responsible for initializing and wiring together all core agent services (LLM, client manager, message manager, event bus, etc.)
 * for the Dexto application. It provides a single entry point for constructing the service graph, ensuring consistent dependency injection
 * and configuration across CLI, web, and test environments.
 *
 * **Configuration Pattern:**
 * - The primary source of configuration is the config file (e.g., `agent.yml`), which allows users to declaratively specify both high-level
 *   and low-level service options (such as compression strategies for ContextManager, LLM provider/model, etc.).
 * - For most use cases, the config file is sufficient and preferred, as it enables environment-specific, auditable, and user-friendly customization.
 *
 * **Service Architecture:**
 * - All services are initialized based on the provided configuration.
 * - For testing scenarios, mock the service dependencies directly using test frameworks rather than relying on service injection patterns.
 *
 * **Best Practice:**
 * - Use the config file for all user-facing and environment-specific configuration, including low-level service details.
 * - For testing, use proper mocking frameworks rather than service injection to ensure clean, maintainable tests.
 *
 * This pattern ensures a clean, scalable, and maintainable architecture, balancing flexibility with simplicity.
 */

import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import { dirname, resolve } from 'path';
import * as path from 'path';
import { createStorageManager, StorageManager } from '../storage/index.js';
import { createAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/factory.js';
import { logger } from '../logger/index.js';
import type { ValidatedAgentConfig } from '@core/agent/schemas.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { ApprovalManager } from '../approval/manager.js';
import { MemoryManager } from '../memory/index.js';
import { PluginManager } from '../plugins/manager.js';
import { registerBuiltInPlugins } from '../plugins/registrations/builtins.js';
import { FileSystemService } from '../filesystem/index.js';
import { ProcessService } from '../process/index.js';
import { TodoService } from '../todo/todo-service.js';

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

// High-level factory to load, validate, and wire up all agent services in one call
/**
 * Initializes all agent services from a validated configuration.
 * @param config The validated agent configuration object
 * @param configPath Optional path to the config file (for relative path resolution)
 * @param agentId Optional agent identifier used for database naming (default: derived from config or 'default-agent')
 * @returns All the initialized services required for a Dexto agent
 */
export async function createAgentServices(
    config: ValidatedAgentConfig,
    configPath?: string,
    agentId?: string
): Promise<AgentServices> {
    // 0. Initialize telemetry FIRST (before any decorated classes are instantiated)
    // This must happen before creating any services that use @InstrumentClass decorator
    if (config.telemetry?.enabled) {
        const { Telemetry } = await import('../telemetry/telemetry.js');
        await Telemetry.init(config.telemetry);
        logger.debug('Telemetry initialized');
    }

    // 1. Initialize shared event bus
    const agentEventBus: AgentEventBus = new AgentEventBus();
    logger.debug('Agent event bus initialized');

    // 2. Derive agent ID for database naming (if not provided)
    const effectiveAgentId =
        agentId ||
        config.agentCard?.name ||
        (configPath ? path.basename(configPath, path.extname(configPath)) : undefined) ||
        'default-agent';

    // 3. Initialize storage manager with agent ID
    logger.debug('Initializing storage manager', { agentId: effectiveAgentId });
    const storageManager = await createStorageManager(config.storage, effectiveAgentId);

    logger.debug('Storage manager initialized', {
        cache: config.storage.cache.type,
        database: config.storage.database.type,
    });

    // 3. Initialize approval system (generalized user approval)
    // Created before MCP manager since MCP manager depends on it for elicitation support
    logger.debug('Initializing approval manager');
    const approvalManager = new ApprovalManager(agentEventBus, {
        toolConfirmation: {
            mode: config.toolConfirmation.mode,
            timeout: config.toolConfirmation.timeout,
        },
        elicitation: {
            enabled: config.elicitation.enabled,
            timeout: config.elicitation.timeout,
        },
    });
    logger.debug('Approval system initialized');

    // 4. Initialize MCP manager
    const mcpManager = new MCPManager();
    await mcpManager.initializeFromConfig(config.mcpServers);

    // 4.1 - Wire approval manager into MCP manager for elicitation support
    mcpManager.setApprovalManager(approvalManager);
    logger.debug('Approval manager connected to MCP manager for elicitation support');

    // 5. Initialize search service
    const searchService = new SearchService(storageManager.getDatabase());

    // 6. Initialize memory manager
    const memoryManager = new MemoryManager(storageManager.getDatabase());
    logger.debug('Memory manager initialized');

    // 6.5 Initialize plugin manager
    const configDir = configPath ? dirname(resolve(configPath)) : process.cwd();
    const pluginManager = new PluginManager({
        agentEventBus,
        storageManager,
        configDir,
    });

    // Register built-in plugins from registry
    registerBuiltInPlugins({ pluginManager, config });
    logger.debug('Built-in plugins registered');

    // Initialize plugin manager (loads custom plugins, validates, calls initialize())
    await pluginManager.initialize(config.plugins.custom);
    logger.info('Plugin manager initialized');

    // TODO: Consider lazy initialization of ProcessService and FileSystemService
    // - Only initialize if they will be used by some tools
    // 7. Initialize FileSystemService and ProcessService for internal tools
    const fileSystemService = new FileSystemService({
        allowedPaths: ['.'],
        blockedPaths: ['.git', 'node_modules/.bin', '.env'],
        blockedExtensions: ['.exe', '.dll', '.so'],
        workingDirectory: process.cwd(),
    });
    await fileSystemService.initialize();
    logger.debug('FileSystemService initialized');

    const processService = new ProcessService({
        securityLevel: 'moderate',
        workingDirectory: process.cwd(),
    });
    await processService.initialize();
    logger.debug('ProcessService initialized');

    // 7.5. Initialize TodoService for task management
    const todoService = new TodoService(storageManager.getDatabase(), agentEventBus);
    await todoService.initialize();
    logger.debug('TodoService initialized');

    // 8. Initialize tool manager with internal tools options
    // 8.1 - Create allowed tools provider based on configuration
    const allowedToolsProvider = createAllowedToolsProvider({
        type: config.toolConfirmation.allowedToolsStorage,
        storageManager,
    });

    // 8.2 - Initialize tool manager with direct ApprovalManager integration
    const toolManager = new ToolManager(
        mcpManager,
        approvalManager,
        allowedToolsProvider,
        config.toolConfirmation.mode,
        agentEventBus,
        config.toolConfirmation.toolPolicies,
        {
            internalToolsServices: {
                searchService,
                fileSystemService,
                processService,
                todoService,
                // sessionManager will be set after SessionManager is created
            },
            internalToolsConfig: config.internalTools,
        }
    );
    await toolManager.initialize();

    const mcpServerCount = Object.keys(config.mcpServers).length;
    if (mcpServerCount === 0) {
        logger.info('Agent initialized without MCP servers - only built-in capabilities available');
    } else {
        logger.debug(`MCPManager initialized with ${mcpServerCount} MCP server(s)`);
    }

    if (config.internalTools.length === 0) {
        logger.info('No internal tools enabled by configuration');
    } else {
        logger.info(`Internal tools enabled: ${config.internalTools.join(', ')}`);
    }

    // 9. Initialize prompt manager
    logger.debug(
        `[ServiceInitializer] Creating SystemPromptManager with configPath: ${configPath} → configDir: ${configDir}`
    );
    const systemPromptManager = new SystemPromptManager(
        config.systemPrompt,
        configDir,
        memoryManager
    );

    // 10. Initialize state manager for runtime state tracking
    const stateManager = new AgentStateManager(config, agentEventBus);
    logger.debug('Agent state manager initialized');

    // 11. Initialize resource manager (MCP + internal resources)
    const resourceManager = new ResourceManager(mcpManager, {
        internalResourcesConfig: config.internalResources,
        blobStore: storageManager.getBlobStore(),
    });
    await resourceManager.initialize();

    // 12. Initialize session manager
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
            maxSubAgentDepth: config.sessions?.maxSubAgentDepth,
            subAgentLifecycle: config.sessions?.subAgentLifecycle,
        }
    );

    // Initialize the session manager with persistent storage
    await sessionManager.init();

    logger.debug('Session manager initialized with storage support');

    // 12.5 Wire up plugin support to ToolManager (after SessionManager is created)
    toolManager.setPluginSupport(pluginManager, sessionManager, stateManager);
    logger.debug('Plugin support connected to ToolManager');

    // 12.6 Wire up SessionManager to internal tools (for spawn_agent tool)
    toolManager.setSessionManager(sessionManager);
    logger.debug('SessionManager connected to internal tools');

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
