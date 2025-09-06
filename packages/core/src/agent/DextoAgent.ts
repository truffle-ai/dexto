// src/agent/DextoAgent.ts
import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { PromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from './state-manager.js';
import { SessionManager, ChatSession, SessionError } from '../session/index.js';
import type { SessionMetadata } from '../session/index.js';
import { AgentServices } from '../utils/service-initializer.js';
import { logger } from '../logger/index.js';
import { ValidatedLLMConfig, LLMConfig, LLMUpdates, LLMUpdatesSchema } from '@core/llm/schemas.js';
import { resolveAndValidateLLMConfig } from '../llm/resolver.js';
import { validateInputForLLM } from '../llm/validation.js';
import { AgentError } from './errors.js';
import { MCPError } from '../mcp/errors.js';
import { ensureOk } from '@core/errors/result-bridge.js';
import { fail, zodToIssues } from '@core/utils/result.js';
import { resolveAndValidateMcpServerConfig } from '../mcp/resolver.js';
import type { McpServerConfig } from '@core/mcp/schemas.js';
import {
    getSupportedProviders,
    getDefaultModelForProvider,
    getProviderFromModel,
    LLM_REGISTRY,
    ModelInfo,
} from '../llm/registry.js';
import type { LLMProvider } from '../llm/types.js';
import { createAgentServices } from '../utils/service-initializer.js';
import type { AgentConfig, ValidatedAgentConfig } from './schemas.js';
import { AgentConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import type { IMCPClient } from '../mcp/types.js';
import type { ToolSet } from '../tools/types.js';
import { SearchService } from '../search/index.js';
import type { SearchOptions, SearchResponse, SessionSearchResponse } from '../search/index.js';
import { getDextoPath } from '../utils/path.js';
import { safeStringify } from '@core/utils/safe-stringify.js';

const requiredServices: (keyof AgentServices)[] = [
    'mcpManager',
    'toolManager',
    'promptManager',
    'agentEventBus',
    'stateManager',
    'sessionManager',
    'searchService',
];

/**
 * The main entry point into Dexto's core functionality.
 *
 * DextoAgent is a high-level abstraction layer that provides a clean, user-facing API
 * for building AI agents. It coordinates multiple internal services to deliver core
 * capabilities including conversation management, LLM switching, MCP server integration,
 * and multi-session support.
 *
 * Key Features:
 * - **Conversation Management**: Process user messages and maintain conversation state
 * - **Multi-Session Support**: Create and manage multiple independent chat sessions
 * - **Dynamic LLM Switching**: Change language models while preserving conversation history
 * - **MCP Server Integration**: Connect to and manage Model Context Protocol servers
 * - **Tool Execution**: Execute tools from connected MCP servers
 * - **Prompt Management**: Build and inspect dynamic system prompts with context
 * - **Event System**: Emit events for integration with external systems
 *
 * Design Principles:
 * - Thin wrapper around internal services with high-level methods
 * - Primary API for applications building on Dexto
 * - Internal services exposed as public readonly properties for advanced usage
 * - Backward compatibility through default session management
 *
 * @example
 * ```typescript
 * // Create and start agent
 * const agent = new DextoAgent(config);
 * await agent.start();
 *
 * // Process user messages
 * const response = await agent.run("Hello, how are you?");
 *
 * // Switch LLM models (provider inferred automatically)
 * await agent.switchLLM({ model: 'gpt-4o' });
 *
 * // Manage sessions
 * const session = agent.createSession('user-123');
 * const response = await agent.run("Hello", undefined, 'user-123');
 *
 * // Connect MCP servers
 * await agent.connectMcpServer('filesystem', { command: 'mcp-filesystem' });
 *
 * // Inspect available tools and system prompt
 * const tools = await agent.getAllMcpTools();
 * const prompt = await agent.getSystemPrompt();
 *
 * // Gracefully stop the agent when done
 * await agent.stop();
 * ```
 */

export class DextoAgent {
    /**
     * These services are public for use by the outside world
     * This gives users the option to use methods of the services directly if they know what they are doing
     * But the main recommended entry points/functions would still be the wrapper methods we define below
     */
    public readonly mcpManager!: MCPManager;
    public readonly promptManager!: PromptManager;
    public readonly agentEventBus!: AgentEventBus;
    public readonly stateManager!: AgentStateManager;
    public readonly sessionManager!: SessionManager;
    public readonly toolManager!: ToolManager;
    public readonly services!: AgentServices;

    // Search service for conversation search
    private searchService!: SearchService;

    // Default session for backward compatibility
    private defaultSession: ChatSession | null = null;

    // Current default session ID for loadSession functionality
    private currentDefaultSessionId: string = 'default';

    // Track initialization state
    private _isStarted: boolean = false;
    private _isStopped: boolean = false;

    // Store config for async initialization
    private config: ValidatedAgentConfig;

    constructor(
        config: AgentConfig,
        private configPath?: string
    ) {
        // Validate and transform the input config
        this.config = AgentConfigSchema.parse(config);

        // call start() to initialize services
        logger.info('DextoAgent created.');
    }

    /**
     * Starts the agent by initializing all async services.
     * This method handles storage backends, MCP connections, session manager initialization, and other async operations.
     * Must be called before using any agent functionality.
     *
     * @throws Error if agent is already started or initialization fails
     */
    public async start(): Promise<void> {
        if (this._isStarted) {
            throw AgentError.alreadyStarted();
        }

        try {
            logger.info('Starting DextoAgent...');

            // Initialize all services asynchronously
            const services = await createAgentServices(this.config, this.configPath);

            // Validate all required services are provided
            for (const service of requiredServices) {
                if (!services[service]) {
                    throw AgentError.initializationFailed(
                        `Required service ${service} is missing during agent start`
                    );
                }
            }

            // Use Object.assign to set readonly properties
            Object.assign(this, {
                mcpManager: services.mcpManager,
                toolManager: services.toolManager,
                promptManager: services.promptManager,
                agentEventBus: services.agentEventBus,
                stateManager: services.stateManager,
                sessionManager: services.sessionManager,
                services: services,
            });

            // Initialize search service from services
            this.searchService = services.searchService;

            this._isStarted = true;
            logger.info('DextoAgent started successfully.');

            // Show log location for SDK users
            const logPath = getDextoPath('logs', 'dexto.log');
            console.log(`📋 Logs available at: ${logPath}`);
        } catch (error) {
            logger.error('Failed to start DextoAgent', error);
            throw error;
        }
    }

    /**
     * Stops the agent and gracefully shuts down all services.
     * This method handles disconnecting MCP clients, cleaning up sessions, closing storage connections,
     * and releasing all resources. The agent cannot be restarted after being stopped.
     *
     * @throws Error if agent has not been started or shutdown fails
     */
    public async stop(): Promise<void> {
        if (this._isStopped) {
            logger.warn('Agent is already stopped');
            return;
        }

        if (!this._isStarted) {
            throw AgentError.notStarted();
        }

        try {
            logger.info('Stopping DextoAgent...');

            const shutdownErrors: Error[] = [];

            // 1. Clean up session manager (stop accepting new sessions, clean existing ones)
            try {
                if (this.sessionManager) {
                    await this.sessionManager.cleanup();
                    logger.debug('SessionManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`SessionManager cleanup failed: ${err.message}`));
            }

            // 2. Disconnect all MCP clients
            try {
                if (this.mcpManager) {
                    await this.mcpManager.disconnectAll();
                    logger.debug('MCPManager disconnected all clients successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`MCPManager disconnect failed: ${err.message}`));
            }

            // 3. Close storage backends
            try {
                if (this.services?.storageManager) {
                    await this.services.storageManager.disconnect();
                    logger.debug('Storage manager disconnected successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`Storage disconnect failed: ${err.message}`));
            }

            this._isStopped = true;
            this._isStarted = false;

            if (shutdownErrors.length > 0) {
                const errorMessages = shutdownErrors.map((e) => e.message).join('; ');
                logger.warn(`DextoAgent stopped with some errors: ${errorMessages}`);
                // Still consider it stopped, but log the errors
            } else {
                logger.info('DextoAgent stopped successfully.');
            }
        } catch (error) {
            logger.error('Failed to stop DextoAgent', error);
            throw error;
        }
    }

    /**
     * Checks if the agent has been started.
     * @returns true if agent is started, false otherwise
     */
    public isStarted(): boolean {
        return this._isStarted;
    }

    /**
     * Checks if the agent has been stopped.
     * @returns true if agent is stopped, false otherwise
     */
    public isStopped(): boolean {
        return this._isStopped;
    }

    /**
     * Ensures the agent is started before executing operations.
     * @throws Error if agent is not started or has been stopped
     */
    private ensureStarted(): void {
        if (this._isStopped) {
            logger.warn('Agent is stopped');
            throw AgentError.stopped();
        }
        if (!this._isStarted) {
            logger.warn('Agent is not started');
            throw AgentError.notStarted();
        }
    }

    // ============= CORE AGENT FUNCTIONALITY =============

    /**
     * Main method for processing user input.
     * Processes user input through the agent's LLM service and returns the response.
     *
     * @param textInput - The user's text message or query to process
     * @param imageDataInput - Optional image data and MIME type for multimodal input
     * @param fileDataInput - Optional file data and MIME type for file input
     * @param sessionId - Optional session ID for multi-session scenarios
     * @returns Promise that resolves to the AI's response text, or null if no significant response
     * @throws Error if processing fails
     */
    public async run(
        textInput: string,
        imageDataInput?: { image: string; mimeType: string },
        fileDataInput?: { data: string; mimeType: string; filename?: string },
        sessionId?: string,
        stream: boolean = false
    ): Promise<string> {
        this.ensureStarted();
        try {
            // Determine target session ID for validation
            const targetSessionId = sessionId || this.currentDefaultSessionId;

            // Get session-specific LLM config for validation
            const llmConfig = this.stateManager.getLLMConfig(targetSessionId);

            // Validate inputs early using session-specific config
            const validation = validateInputForLLM(
                {
                    text: textInput,
                    ...(imageDataInput && { imageData: imageDataInput }),
                    ...(fileDataInput && { fileData: fileDataInput }),
                },
                {
                    provider: llmConfig.provider,
                    model: llmConfig.model,
                }
            );

            // Validate input and throw if invalid
            ensureOk(validation);

            // Resolve the concrete ChatSession for the target session id
            const existingSession = await this.sessionManager.getSession(targetSessionId);
            const session: ChatSession =
                existingSession || (await this.sessionManager.createSession(targetSessionId));

            logger.debug(
                `DextoAgent.run: sessionId=${targetSessionId}, textLength=${textInput?.length ?? 0}, hasImage=${Boolean(
                    imageDataInput
                )}, hasFile=${Boolean(fileDataInput)}`
            );
            const response = await session.run(textInput, imageDataInput, fileDataInput, stream);

            // Increment message count for this session (counts each)
            // Fire-and-forget to avoid race conditions during shutdown
            this.sessionManager
                .incrementMessageCount(session.id)
                .catch((error) =>
                    logger.warn(
                        `Failed to increment message count: ${error instanceof Error ? error.message : String(error)}`
                    )
                );

            return response;
        } catch (error) {
            logger.error(
                `Error during DextoAgent.run: ${error instanceof Error ? error.message : JSON.stringify(error)}`
            );
            throw error;
        }
    }

    /**
     * Cancels the currently running turn for a session (or the default session).
     * Safe to call even if no run is in progress.
     * @param sessionId Optional session id; defaults to current default session
     * @returns true if a run was in progress and was signaled to abort; false otherwise
     */
    public async cancel(sessionId?: string): Promise<boolean> {
        this.ensureStarted();
        const targetSessionId = sessionId || this.currentDefaultSessionId;
        // Try to use in-memory default session if applicable
        if (!sessionId && this.defaultSession && this.defaultSession.id === targetSessionId) {
            return this.defaultSession.cancel();
        }
        // If specific session is requested, attempt to fetch from sessionManager cache (memory only)
        const existing = await this.sessionManager.getSession(targetSessionId, false);
        if (existing) {
            return existing.cancel();
        }
        // If not found, nothing to cancel
        return false;
    }

    // ============= SESSION MANAGEMENT =============

    /**
     * Creates a new chat session or returns an existing one.
     * @param sessionId Optional session ID. If not provided, a UUID will be generated.
     * @returns The created or existing ChatSession
     */
    public async createSession(sessionId?: string): Promise<ChatSession> {
        this.ensureStarted();
        return await this.sessionManager.createSession(sessionId);
    }

    /**
     * Retrieves an existing session by ID.
     * @param sessionId The session ID to retrieve
     * @returns The ChatSession if found, undefined otherwise
     */
    public async getSession(sessionId: string): Promise<ChatSession | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSession(sessionId);
    }

    /**
     * Lists all active session IDs.
     * @returns Array of session IDs
     */
    public async listSessions(): Promise<string[]> {
        this.ensureStarted();
        return await this.sessionManager.listSessions();
    }

    /**
     * Ends a session by removing it from memory without deleting conversation history.
     * Used for cleanup, agent shutdown, and session expiry.
     * @param sessionId The session ID to end
     */
    public async endSession(sessionId: string): Promise<void> {
        this.ensureStarted();
        // If ending the currently loaded default session, clear our reference
        if (sessionId === this.currentDefaultSessionId) {
            this.defaultSession = null;
        }
        return this.sessionManager.endSession(sessionId);
    }

    /**
     * Deletes a session and its conversation history permanently.
     * Used for user-initiated permanent deletion.
     * @param sessionId The session ID to delete
     */
    public async deleteSession(sessionId: string): Promise<void> {
        this.ensureStarted();
        // If deleting the currently loaded default session, clear our reference
        if (sessionId === this.currentDefaultSessionId) {
            this.defaultSession = null;
        }
        return this.sessionManager.deleteSession(sessionId);
    }

    /**
     * Gets metadata for a specific session.
     * @param sessionId The session ID
     * @returns The session metadata if found, undefined otherwise
     */
    public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSessionMetadata(sessionId);
    }

    /**
     * Gets the conversation history for a specific session.
     * @param sessionId The session ID
     * @returns Promise that resolves to the session's conversation history
     * @throws Error if session doesn't exist
     */
    public async getSessionHistory(sessionId: string) {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return await session.getHistory();
    }

    /**
     * Search for messages across all sessions or within a specific session
     *
     * @param query The search query string
     * @param options Search options including session filter, role filter, and pagination
     * @returns Promise that resolves to search results
     */
    public async searchMessages(
        query: string,
        options: SearchOptions = {}
    ): Promise<SearchResponse> {
        this.ensureStarted();
        return await this.searchService.searchMessages(query, options);
    }

    /**
     * Search for sessions that contain the specified query
     *
     * @param query The search query string
     * @returns Promise that resolves to session search results
     */
    public async searchSessions(query: string): Promise<SessionSearchResponse> {
        this.ensureStarted();
        return await this.searchService.searchSessions(query);
    }

    /**
     * Loads a session as the new "default" session for this agent.
     * All subsequent operations that don't specify a session ID will use this session.
     * This provides a clean "current working session" pattern for API users.
     *
     * @param sessionId The session ID to load as default, or null to reset to original default
     * @throws Error if session doesn't exist
     *
     * @example
     * ```typescript
     * // Load a specific session as default
     * await agent.loadSessionAsDefault('project-alpha');
     * await agent.run("What's the status?"); // Uses project-alpha session
     *
     * // Reset to original default
     * await agent.loadSessionAsDefault(null);
     * await agent.run("Hello"); // Uses 'default' session
     * ```
     */
    public async loadSessionAsDefault(sessionId: string | null = null): Promise<void> {
        this.ensureStarted();
        if (sessionId === null) {
            this.currentDefaultSessionId = 'default';
            this.defaultSession = null; // Clear cached session to force reload
            logger.debug('Agent default session reset to original default');
            return;
        }

        // Verify session exists before loading it
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        this.currentDefaultSessionId = sessionId;
        this.defaultSession = null; // Clear cached session to force reload
        logger.info(`Agent default session changed to: ${sessionId}`);
    }

    /**
     * Gets the currently loaded default session ID.
     * This reflects the session loaded via loadSession().
     *
     * @returns The current default session ID
     */
    public getCurrentSessionId(): string {
        this.ensureStarted();
        return this.currentDefaultSessionId;
    }

    /**
     * Gets the currently loaded default session.
     * This respects the session loaded via loadSession().
     *
     * @returns The current default ChatSession
     */
    public async getDefaultSession(): Promise<ChatSession> {
        this.ensureStarted();
        if (!this.defaultSession || this.defaultSession.id !== this.currentDefaultSessionId) {
            this.defaultSession = await this.sessionManager.createSession(
                this.currentDefaultSessionId
            );
        }
        return this.defaultSession;
    }

    /**
     * Resets the conversation history for a specific session or the default session.
     * Keeps the session alive but the conversation history is cleared.
     * @param sessionId Optional session ID. If not provided, resets the currently loaded default session.
     */
    public async resetConversation(sessionId?: string): Promise<void> {
        this.ensureStarted();
        try {
            const targetSessionId = sessionId || this.currentDefaultSessionId;

            // Ensure session exists or create loaded default session
            if (!sessionId) {
                // Use loaded default session for backward compatibility
                if (
                    !this.defaultSession ||
                    this.defaultSession.id !== this.currentDefaultSessionId
                ) {
                    this.defaultSession = await this.sessionManager.createSession(
                        this.currentDefaultSessionId
                    );
                }
            }

            // Use SessionManager's resetSession method for better consistency
            await this.sessionManager.resetSession(targetSessionId);

            logger.info(`DextoAgent conversation reset for session: ${targetSessionId}`);
            this.agentEventBus.emit('dexto:conversationReset', {
                sessionId: targetSessionId,
            });
        } catch (error) {
            logger.error(
                `Error during DextoAgent.resetConversation: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Gets the current LLM configuration with all defaults applied.
     * @returns Current LLM configuration
     */
    public getCurrentLLMConfig(): LLMConfig {
        this.ensureStarted();
        return structuredClone(this.stateManager.getLLMConfig()) as LLMConfig;
    }

    /**
     * Switches the LLM service while preserving conversation history.
     * This is a comprehensive method that handles ALL validation, configuration building, and switching internally.
     *
     * Design:
     * - Input: Partial<LLMConfig> (allows optional fields like maxIterations?, router?)
     * - Output: LLMConfig (user-friendly type with all defaults applied)
     *
     * Key features:
     * - Accepts partial LLM configuration object
     * - Extracts and validates parameters internally
     * - Infers provider from model if not provided
     * - Automatically resolves API keys from environment variables
     * - Uses LLMConfigSchema for comprehensive validation
     * - Prevents inconsistent partial updates
     * - Smart defaults for missing configuration values
     *
     * @param llmUpdates Partial LLM configuration object containing the updates to apply
     * @param sessionId Session ID to switch LLM for. If not provided, switches for default session. Use '*' for all sessions
     * @returns Promise that resolves with the validated LLM configuration
     * @throws DextoLLMError if validation fails or switching fails
     *
     * @example
     * ```typescript
     * // Switch to a different model (provider will be inferred, API key auto-resolved)
     * await agent.switchLLM({ model: 'gpt-4o' });
     *
     * // Switch to a different provider with explicit API key
     * await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514', apiKey: 'sk-ant-...' });
     *
     * // Switch with router and session options
     * await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514', router: 'in-built' }, 'user-123');
     *
     * // Switch for all sessions
     * await agent.switchLLM({ model: 'gpt-4o' }, '*');
     * ```
     */
    public async switchLLM(
        llmUpdates: LLMUpdates,
        sessionId?: string
    ): Promise<ValidatedLLMConfig> {
        this.ensureStarted();

        // Validate input using schema (single source of truth)
        logger.debug(`DextoAgent.switchLLM: llmUpdates: ${safeStringify(llmUpdates)}`);
        const parseResult = LLMUpdatesSchema.safeParse(llmUpdates);
        if (!parseResult.success) {
            const validation = fail(zodToIssues(parseResult.error, 'error'));
            ensureOk(validation); // This will throw DextoValidationError
            throw new Error('Unreachable'); // For TypeScript
        }
        const validatedUpdates = parseResult.data;

        // Get current config for the session
        const currentLLMConfig = sessionId
            ? this.stateManager.getRuntimeConfig(sessionId).llm
            : this.stateManager.getRuntimeConfig().llm;

        // Build and validate the new configuration using Result pattern internally
        const result = resolveAndValidateLLMConfig(currentLLMConfig, validatedUpdates);
        const validatedConfig = ensureOk(result);

        // Perform the actual LLM switch with validated config
        await this.performLLMSwitch(validatedConfig, sessionId);
        logger.info(`DextoAgent.switchLLM: LLM switched to: ${safeStringify(validatedConfig)}`);

        // Log warnings if present
        const warnings = result.issues.filter((issue) => issue.severity === 'warning');
        if (warnings.length > 0) {
            logger.warn(
                `LLM switch completed with warnings: ${warnings.map((w) => w.message).join(', ')}`
            );
        }

        // Return the validated config directly
        return validatedConfig;
    }

    /**
     * Performs the actual LLM switch with a validated configuration.
     * This is a helper method that handles state management and session switching.
     *
     * @param validatedConfig - The validated LLM configuration to apply
     * @param sessionScope - Session ID, '*' for all sessions, or undefined for default session
     */
    private async performLLMSwitch(
        validatedConfig: ValidatedLLMConfig,
        sessionScope?: string
    ): Promise<void> {
        // Update state manager (no validation needed - already validated)
        this.stateManager.updateLLM(validatedConfig, sessionScope);

        // Switch LLM in session(s)
        if (sessionScope === '*') {
            await this.sessionManager.switchLLMForAllSessions(validatedConfig);
        } else if (sessionScope) {
            // Verify session exists before switching LLM
            const session = await this.sessionManager.getSession(sessionScope);
            if (!session) {
                throw SessionError.notFound(sessionScope);
            }
            await this.sessionManager.switchLLMForSpecificSession(validatedConfig, sessionScope);
        } else {
            await this.sessionManager.switchLLMForDefaultSession(validatedConfig);
        }
    }

    /**
     * Gets all supported LLM providers.
     * Returns a strongly-typed array of valid provider names that can be used with the agent.
     *
     * @returns Array of supported provider names
     *
     * @example
     * ```typescript
     * const providers = agent.getSupportedProviders();
     * console.log(providers); // ['openai', 'anthropic', 'google', 'groq']
     * ```
     */
    public getSupportedProviders(): LLMProvider[] {
        return getSupportedProviders() as LLMProvider[];
    }

    /**
     * Gets all supported models grouped by provider with detailed information.
     * Returns a strongly-typed object mapping each provider to its available models,
     * including model metadata such as token limits and default status.
     *
     * @returns Object mapping provider names to their model information
     *
     * @example
     * ```typescript
     * const models = agent.getSupportedModels();
     * console.log(models.openai); // Array of OpenAI models with metadata
     * console.log(models.anthropic[0].maxInputTokens); // Token limit for first Anthropic model
     *
     * // Check if a model is the default for its provider
     * const hasDefault = models.google.some(model => model.isDefault);
     * ```
     */
    public getSupportedModels(): Record<LLMProvider, Array<ModelInfo & { isDefault: boolean }>> {
        const result = {} as Record<LLMProvider, Array<ModelInfo & { isDefault: boolean }>>;

        const providers = getSupportedProviders() as LLMProvider[];
        for (const provider of providers) {
            const defaultModel = getDefaultModelForProvider(provider);
            const providerInfo = LLM_REGISTRY[provider];

            result[provider] = providerInfo.models.map((model) => ({
                ...model,
                isDefault: model.name === defaultModel,
            }));
        }

        return result;
    }

    /**
     * Gets supported models for a specific provider.
     * Returns model information including metadata for the specified provider only.
     *
     * @param provider The provider to get models for
     * @returns Array of model information for the specified provider
     * @throws Error if provider is not supported
     *
     * @example
     * ```typescript
     * try {
     *   const openaiModels = agent.getSupportedModelsForProvider('openai');
     *   const defaultModel = openaiModels.find(model => model.isDefault);
     *   console.log(`Default OpenAI model: ${defaultModel?.name}`);
     * } catch (error) {
     *   console.error('Unsupported provider');
     * }
     * ```
     */
    public getSupportedModelsForProvider(
        provider: LLMProvider
    ): Array<ModelInfo & { isDefault: boolean }> {
        const defaultModel = getDefaultModelForProvider(provider);
        const providerInfo = LLM_REGISTRY[provider];

        return providerInfo.models.map((model) => ({
            ...model,
            isDefault: model.name === defaultModel,
        }));
    }

    /**
     * Infers the provider from a model name.
     * Searches through all supported providers to find which one supports the given model.
     *
     * @param modelName The model name to search for
     * @returns The provider name if found, null if the model is not supported
     *
     * @example
     * ```typescript
     * const provider = agent.inferProviderFromModel('gpt-4o');
     * console.log(provider); // 'openai'
     *
     * const provider2 = agent.inferProviderFromModel('claude-4-sonnet-20250514');
     * console.log(provider2); // 'anthropic'
     *
     * const provider3 = agent.inferProviderFromModel('unknown-model');
     * console.log(provider3); // null
     * ```
     */
    public inferProviderFromModel(modelName: string): LLMProvider | null {
        try {
            return getProviderFromModel(modelName) as LLMProvider;
        } catch {
            return null;
        }
    }

    // ============= MCP SERVER MANAGEMENT =============

    /**
     * Connects a new MCP server and adds it to the runtime configuration.
     * This method handles validation, state management, and establishing the connection.
     *
     * @param name The name of the server to connect.
     * @param config The configuration object for the server.
     * @throws DextoError if validation fails or connection fails
     */
    public async connectMcpServer(name: string, config: McpServerConfig): Promise<void> {
        this.ensureStarted();

        // Validate the server configuration
        const existingServerNames = Object.keys(this.stateManager.getRuntimeConfig().mcpServers);
        const validation = resolveAndValidateMcpServerConfig(name, config, existingServerNames);
        const validatedConfig = ensureOk(validation);

        // Add to runtime state (no validation needed - already validated)
        this.stateManager.addMcpServer(name, validatedConfig);

        try {
            // Connect the server
            await this.mcpManager.connectServer(name, validatedConfig);

            this.agentEventBus.emit('dexto:mcpServerConnected', {
                name,
                success: true,
            });
            this.agentEventBus.emit('dexto:availableToolsUpdated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            logger.info(`DextoAgent: Successfully added and connected to MCP server '${name}'.`);

            // Log warnings if present
            const warnings = validation.issues.filter((i) => i.severity === 'warning');
            if (warnings.length > 0) {
                logger.warn(
                    `MCP server connected with warnings: ${warnings.map((w) => w.message).join(', ')}`
                );
            }

            // Connection successful - method completes without returning data
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`DextoAgent: Failed to connect to MCP server '${name}': ${errorMessage}`);

            // Clean up state if connection failed
            this.stateManager.removeMcpServer(name);

            this.agentEventBus.emit('dexto:mcpServerConnected', {
                name,
                success: false,
                error: errorMessage,
            });

            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    /**
     * Removes and disconnects an MCP server.
     * @param name The name of the server to remove.
     */
    public async removeMcpServer(name: string): Promise<void> {
        this.ensureStarted();
        // Disconnect the client first
        await this.mcpManager.removeClient(name);

        // Then remove from runtime state
        this.stateManager.removeMcpServer(name);
    }

    /**
     * Executes a tool from any source (MCP servers, custom tools, or internal tools).
     * This is the unified interface for tool execution that can handle all tool types.
     * @param toolName The name of the tool to execute
     * @param args The arguments to pass to the tool
     * @returns The result of the tool execution
     */
    public async executeTool(toolName: string, args: any): Promise<any> {
        this.ensureStarted();
        return await this.toolManager.executeTool(toolName, args);
    }

    /**
     * Gets all available tools from all connected MCP servers.
     * Useful for users to discover what tools are available.
     * @returns Promise resolving to a map of tool names to tool definitions
     */
    public async getAllMcpTools(): Promise<ToolSet> {
        this.ensureStarted();
        return await this.mcpManager.getAllTools();
    }

    /**
     * Gets all available tools from all sources (MCP servers and custom tools).
     * This is the unified interface for tool discovery that includes both MCP and custom tools.
     * @returns Promise resolving to a map of tool names to tool definitions
     */
    public async getAllTools(): Promise<ToolSet> {
        this.ensureStarted();
        return await this.toolManager.getAllTools();
    }

    /**
     * Gets all connected MCP clients.
     * Used by the API layer to inspect client status.
     * @returns Map of client names to client instances
     */
    public getMcpClients(): Map<string, IMCPClient> {
        this.ensureStarted();
        return this.mcpManager.getClients();
    }

    /**
     * Gets all failed MCP connections.
     * Used by the API layer to report connection errors.
     * @returns Record of failed connection names to error messages
     */
    public getMcpFailedConnections(): Record<string, string> {
        this.ensureStarted();
        return this.mcpManager.getFailedConnections();
    }

    // ============= PROMPT MANAGEMENT =============

    /**
     * Gets the current system prompt with all dynamic content resolved.
     * This method builds the complete prompt by invoking all configured prompt contributors
     * (static content, dynamic placeholders, MCP resources, etc.) and returns the final
     * prompt string that will be sent to the LLM.
     *
     * Useful for debugging prompt issues, inspecting what context the AI receives,
     * and understanding how dynamic content is being incorporated.
     *
     * @returns Promise resolving to the complete system prompt string
     *
     * @example
     * ```typescript
     * // Get the current system prompt for inspection
     * const prompt = await agent.getSystemPrompt();
     * console.log('Current system prompt:', prompt);
     *
     * // Useful for debugging prompt-related issues
     * if (response.quality === 'poor') {
     *   const prompt = await agent.getSystemPrompt();
     *   console.log('Check if prompt includes expected context:', prompt);
     * }
     * ```
     */
    public async getSystemPrompt(): Promise<string> {
        this.ensureStarted();
        const context = {
            mcpManager: this.mcpManager,
        };
        return await this.promptManager.build(context);
    }

    // ============= CONFIGURATION ACCESS =============

    /**
     * Gets the effective configuration for a session or the default configuration.
     * @param sessionId Optional session ID. If not provided, returns default config.
     * @returns The effective configuration object
     */
    public getEffectiveConfig(sessionId?: string): Readonly<AgentConfig> {
        this.ensureStarted();
        return sessionId
            ? this.stateManager.getRuntimeConfig(sessionId)
            : this.stateManager.getRuntimeConfig();
    }

    // Future methods could encapsulate more complex agent behaviors:
    // - Multi-step task execution with progress tracking
    // - Memory and context management across sessions
    // - Tool chaining and workflow automation
    // - Agent collaboration and delegation
}
