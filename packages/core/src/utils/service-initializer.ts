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
import { createToolConfirmationProvider } from '../tools/confirmation/factory.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import { dirname, resolve } from 'path';
import { createStorageBackends, type StorageBackends, StorageManager } from '../storage/index.js';
import { createAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/factory.js';
import { logger } from '../logger/index.js';
import type { ValidatedAgentConfig } from '@core/agent/schemas.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { BlobService, createBlobService } from '../blob/index.js';

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
    storage: StorageBackends;
    storageManager?: StorageManager;
    resourceManager: ResourceManager;
    blobService: BlobService;
};

// High-level factory to load, validate, and wire up all agent services in one call
/**
 * Initializes all agent services from a validated configuration.
 * @param config The validated agent configuration object
 * @param configPath Optional path to the config file (for relative path resolution)
 * @returns All the initialized services required for a Dexto agent
 */
export async function createAgentServices(
    config: ValidatedAgentConfig,
    configPath?: string
): Promise<AgentServices> {
    // 1. Initialize shared event bus
    const agentEventBus: AgentEventBus = new AgentEventBus();
    logger.debug('Agent event bus initialized');

    // 2. Initialize storage backends (instance-specific, not singleton)
    logger.debug('Initializing storage backends');
    const storageResult = await createStorageBackends(config.storage);
    const storage = storageResult.backends;
    const storageManager = storageResult.manager;

    logger.debug('Storage backends initialized', {
        cache: config.storage.cache.type,
        database: config.storage.database.type,
    });

    // 3. Initialize client manager with configurable tool confirmation
    // Create allowed tools provider based on configuration
    const allowedToolsProvider = createAllowedToolsProvider({
        type: config.toolConfirmation.allowedToolsStorage,
        storage,
    });

    // Create tool confirmation provider with configured mode and timeout
    const confirmationProvider = createToolConfirmationProvider(
        config.toolConfirmation.mode === 'event-based'
            ? {
                  mode: config.toolConfirmation.mode,
                  allowedToolsProvider,
                  agentEventBus,
                  confirmationTimeout: config.toolConfirmation.timeout,
              }
            : {
                  mode: config.toolConfirmation.mode,
                  allowedToolsProvider,
              }
    );

    const mcpManager = new MCPManager();
    await mcpManager.initializeFromConfig(config.mcpServers);

    // Set the approval provider on all MCP clients for elicitation support
    mcpManager.setApprovalProvider(confirmationProvider);

    // 4. Initialize search service
    const searchService = new SearchService(storage.database);

    // 5. Initialize unified tool manager with internal tools options
    const toolManager = new ToolManager(mcpManager, confirmationProvider, agentEventBus, {
        internalToolsServices: { searchService },
        internalToolsConfig: config.internalTools,
    });

    // Initialize the tool manager
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

    // 6. Initialize prompt manager
    const configDir = configPath ? dirname(resolve(configPath)) : process.cwd();
    logger.debug(
        `[ServiceInitializer] Creating SystemPromptManager with configPath: ${configPath} → configDir: ${configDir}`
    );
    const systemPromptManager = new SystemPromptManager(config.systemPrompt, configDir);

    // 7. Initialize state manager for runtime state tracking
    const stateManager = new AgentStateManager(config, agentEventBus);
    logger.debug('Agent state manager initialized');

    // 8. Initialize blob service (infrastructure-level blob storage)
    const blobService = await createBlobService(config.blobStorage);
    logger.debug(`BlobService initialized with ${config.blobStorage.type} backend`);

    // 9. Initialize resource manager (MCP + internal resources)
    const resourceManager = new ResourceManager(mcpManager, {
        internalResourcesConfig: config.internalResources,
        blobService,
    });
    await resourceManager.initialize();

    // 10. Initialize session manager
    const sessionManager = new SessionManager(
        {
            stateManager,
            systemPromptManager,
            toolManager,
            agentEventBus,
            storage, // Add storage backends to session services
            resourceManager, // Add resource manager for blob storage
        },
        {
            maxSessions: config.sessions?.maxSessions,
            sessionTTL: config.sessions?.sessionTTL,
        }
    );

    // Initialize the session manager with persistent storage
    await sessionManager.init();

    logger.debug('Session manager initialized with storage support');

    // 11. Return the core services
    return {
        mcpManager,
        toolManager,
        systemPromptManager,
        agentEventBus,
        stateManager,
        sessionManager,
        searchService,
        storage,
        storageManager,
        resourceManager,
        blobService,
    };
}
