// src/agent/DextoAgent.ts
import path from 'path';
import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ResourceManager, ResourceError, expandMessageReferences } from '../resources/index.js';
import { expandBlobReferences } from '../context/utils.js';
import { PromptsManager } from '../prompts/index.js';
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
import type { CreateMessageRequest, CreateMessageResult } from '@modelcontextprotocol/sdk/types.js';
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
import type { IMCPClient, SamplingRequestContext } from '../mcp/types.js';
import type { ToolSet } from '../tools/types.js';
import { SearchService } from '../search/index.js';
import type { SearchOptions, SearchResponse, SessionSearchResponse } from '../search/index.js';
import { getDextoPath } from '../utils/path.js';
import { safeStringify } from '@core/utils/safe-stringify.js';
import { resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import { getAgentRegistry } from './registry/registry.js';
import { loadAgentConfig } from '../config/loader.js';

const requiredServices: (keyof AgentServices)[] = [
    'mcpManager',
    'toolManager',
    'systemPromptManager',
    'agentEventBus',
    'stateManager',
    'sessionManager',
    'searchService',
];

const SAMPLING_TOOL_BAN_PROMPT =
    'Tools are unavailable for this sampling request. Respond with a direct natural-language answer only. Do not ask to call, reference, or request any tools or functions.';
const SAMPLING_TIMEOUT_METADATA_KEY = 'timeoutMs';
const SAMPLING_TIMEOUT_DEFAULT_MS = 120_000;
const SAMPLING_TIMEOUT_MAX_MS = 300_000;

type NormalizedSamplingRequest = {
    messages: NonNullable<CreateMessageRequest['params']['messages']>;
    systemPrompt?: string;
    modelPreferences?: CreateMessageRequest['params']['modelPreferences'];
    metadata?: Record<string, unknown>;
    overrides: {
        provider?: LLMProvider;
        model?: string;
        hintedModel?: string;
        temperature?: number;
        maxTokens?: number;
    };
};

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
    public readonly systemPromptManager!: SystemPromptManager;
    public readonly agentEventBus!: AgentEventBus;
    public readonly promptsManager!: PromptsManager;
    public readonly stateManager!: AgentStateManager;
    public readonly sessionManager!: SessionManager;
    public readonly toolManager!: ToolManager;
    public readonly resourceManager!: ResourceManager;
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
                resourceManager: services.resourceManager,
                systemPromptManager: services.systemPromptManager,
                agentEventBus: services.agentEventBus,
                stateManager: services.stateManager,
                sessionManager: services.sessionManager,
                services: services,
            });

            // Initialize search service from services
            this.searchService = services.searchService;

            // Auto-configure MCP roots from filesystem resources
            if (this.resourceManager && this.mcpManager) {
                this.mcpManager.autoConfigureRootsFromResourceManager(this.resourceManager);
            }

            if (this.mcpManager && typeof this.mcpManager.setSamplingHandler === 'function') {
                this.mcpManager.setSamplingHandler(this.handleMcpSamplingRequest.bind(this));
            } else {
                logger.debug(
                    'MCP manager does not support sampling handler registration; skipping'
                );
            }

            // Initialize prompts manager (aggregates MCP, internal, starter prompts)
            const promptsManager = new PromptsManager(
                this.mcpManager,
                this.resourceManager,
                'prompts',
                this.config,
                this.agentEventBus,
                services.storage.database
            );
            await promptsManager.initialize();
            Object.assign(this, { promptsManager });

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
            // Expand @resource mentions into content before sending to the model
            let finalText = textInput;
            let finalImageData = imageDataInput;
            if (textInput && textInput.includes('@')) {
                const resources = await this.resourceManager.list();
                const expansion = await expandMessageReferences(textInput, resources, (uri) =>
                    this.resourceManager.read(uri)
                );
                finalText = expansion.expandedMessage;

                // If we extracted images from resources and don't already have image data, use the first extracted image
                if (expansion.extractedImages.length > 0 && !imageDataInput) {
                    const firstImage = expansion.extractedImages[0];
                    if (firstImage) {
                        finalImageData = {
                            image: firstImage.image,
                            mimeType: firstImage.mimeType,
                        };
                        logger.debug(
                            `Using extracted image: ${firstImage.name} (${firstImage.mimeType})`
                        );
                    }
                }
            }

            const response = await session.run(finalText, finalImageData, fileDataInput, stream);

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
        const history = await session.getHistory();
        if (!this.resourceManager) {
            return history;
        }

        return await Promise.all(
            history.map(async (message) => ({
                ...message,
                content: await expandBlobReferences(message.content, this.resourceManager),
            }))
        );
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

            // Ensure tool cache reflects the newly connected server before notifying listeners
            await this.toolManager.refresh();

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

        // Refresh tool cache after server removal so the LLM sees updated set
        await this.toolManager.refresh();
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

    // ============= RESOURCE MANAGEMENT =============

    /**
     * Lists all available resources with their info.
     * This includes resources from MCP servers and any custom resource providers.
     */
    public async listResources(): Promise<import('../resources/index.js').ResourceSet> {
        this.ensureStarted();
        return await this.resourceManager.list();
    }

    /**
     * Checks if a resource exists by URI.
     */
    public async hasResource(uri: string): Promise<boolean> {
        this.ensureStarted();
        return await this.resourceManager.has(uri);
    }

    /**
     * Reads the content of a specific resource by URI.
     */
    public async readResource(
        uri: string
    ): Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult> {
        this.ensureStarted();
        return await this.resourceManager.read(uri);
    }

    /**
     * Lists resources for a specific MCP server.
     */
    public async listResourcesForServer(serverId: string): Promise<
        Array<{
            uri: string;
            name: string;
            originalUri: string;
            serverName: string;
        }>
    > {
        this.ensureStarted();
        const allResources = await this.resourceManager.list();
        const serverResources = Object.values(allResources)
            .filter((resource) => resource.serverName === serverId)
            .map((resource) => {
                const original = (resource.metadata?.originalUri as string) ?? resource.uri;
                const name = resource.name ?? resource.uri.split('/').pop() ?? resource.uri;
                const serverName = resource.serverName ?? serverId;
                return { uri: original, name, originalUri: original, serverName };
            });
        return serverResources;
    }

    /**
     * Adds a filesystem resource configuration dynamically.
     */
    public async addFileSystemResource(paths: string[]): Promise<void> {
        this.ensureStarted();
        if (!paths || paths.length === 0) {
            throw ResourceError.providerError(
                'Internal',
                'addFileSystemResource',
                'paths must contain at least one entry'
            );
        }
        for (const p of paths) {
            if (p.includes('..') || path.isAbsolute(p)) {
                throw ResourceError.providerError(
                    'Internal',
                    'addFileSystemResource',
                    `Invalid path: ${p}. Paths must be relative and not contain '..'`
                );
            }
        }
        const internalProvider = this.resourceManager.getInternalResourcesProvider();
        if (!internalProvider) {
            throw ResourceError.providerNotAvailable('Internal');
        }
        await internalProvider.addResourceConfig({ type: 'filesystem', paths });
        await this.resourceManager.refresh();
        logger.info(`Added filesystem resource with paths: ${paths.join(', ')}`);
    }

    /**
     * Removes a resource handler by type.
     */
    public async removeResourceHandler(type: string): Promise<void> {
        this.ensureStarted();
        const internalProvider = this.resourceManager.getInternalResourcesProvider();
        if (!internalProvider) {
            throw ResourceError.providerNotAvailable('Internal');
        }
        await internalProvider.removeResourceHandler(type);
        await this.resourceManager.refresh();
        logger.info(`Removed resource handler: ${type}`);
    }

    /**
     * Gets the blob service for storing and retrieving binary data.
     * Returns undefined if blob storage is not configured.
     */
    public getBlobService(): import('../blob/index.js').BlobService | undefined {
        this.ensureStarted();
        return this.services.blobService;
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
        return await this.systemPromptManager.build(context);
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

    // ============= AGENT MANAGEMENT =============

    /**
     * Lists available and installed agents from the registry.
     * Returns a structured object containing both installed and available agents,
     * along with metadata like descriptions, authors, and tags.
     *
     * @returns Promise resolving to object with installed and available agent lists
     *
     * @example
     * ```typescript
     * const agents = await agent.listAgents();
     * console.log(agents.installed); // ['default', 'my-custom-agent']
     * console.log(agents.available); // [{ name: 'productivity', description: '...', ... }]
     * console.log(agents.current?.name); // 'default'
     * ```
     */
    public async listAgents(): Promise<{
        installed: Array<{ name: string; description: string; author?: string; tags?: string[] }>;
        available: Array<{ name: string; description: string; author?: string; tags?: string[] }>;
        current?: { name?: string | null };
    }> {
        const agentRegistry = getAgentRegistry();
        const availableMap = agentRegistry.getAvailableAgents();
        const installedNames = await agentRegistry.getInstalledAgents();

        // Build installed agents list with metadata
        const installed = await Promise.all(
            installedNames.map(async (name) => {
                const registryEntry = availableMap[name];
                if (registryEntry) {
                    return {
                        name,
                        description: registryEntry.description,
                        author: registryEntry.author,
                        tags: registryEntry.tags,
                    };
                } else {
                    // Handle locally installed agents not in registry
                    try {
                        const config = await loadAgentConfig(name);
                        const author = config.agentCard?.provider?.organization;
                        const result: {
                            name: string;
                            description: string;
                            author?: string;
                            tags?: string[];
                        } = {
                            name,
                            description: config.agentCard?.description || 'Local agent',
                            tags: [],
                        };
                        if (author) {
                            result.author = author;
                        }
                        return result;
                    } catch {
                        return {
                            name,
                            description: 'Local agent (config unavailable)',
                            tags: [],
                        };
                    }
                }
            })
        );

        // Build available agents list (excluding already installed)
        const available = Object.entries(availableMap)
            .filter(([name]) => !installedNames.includes(name))
            .map(([name, entry]) => ({
                name,
                description: entry.description,
                author: entry.author,
                tags: entry.tags,
            }));

        return {
            installed,
            available,
            current: { name: null }, // TODO: Track current agent name
        };
    }

    /**
     * Installs an agent from the registry.
     * Downloads and sets up the specified agent, making it available for use.
     *
     * @param agentName The name of the agent to install from the registry
     * @returns Promise that resolves when installation is complete
     *
     * @throws {AgentError} When agent is not found in registry or installation fails
     *
     * @example
     * ```typescript
     * await agent.installAgent('productivity');
     * console.log('Productivity agent installed successfully');
     * ```
     */
    public async installAgent(agentName: string): Promise<void> {
        const agentRegistry = getAgentRegistry();

        if (!agentRegistry.hasAgent(agentName)) {
            throw AgentError.apiValidationError(`Agent '${agentName}' not found in registry`);
        }

        try {
            await agentRegistry.installAgent(agentName, true);
            logger.info(`Successfully installed agent: ${agentName}`);
        } catch (error) {
            logger.error(`Failed to install agent ${agentName}:`, error);
            throw AgentError.apiValidationError(
                `Installation failed for agent '${agentName}'`,
                error
            );
        }
    }

    /**
     * Creates a new agent instance for the specified agent name.
     * This method resolves the agent (installing if needed), loads its configuration,
     * and returns a new DextoAgent instance ready to be started.
     *
     * This is a factory method that doesn't affect the current agent instance.
     * The caller is responsible for managing the lifecycle of the returned agent.
     *
     * @param agentName The name of the agent to create
     * @returns Promise resolving to a new DextoAgent instance (not started)
     *
     * @throws {AgentError} When agent is not found or creation fails
     *
     * @example
     * ```typescript
     * const newAgent = await DextoAgent.createAgent('productivity');
     * await newAgent.start();
     * ```
     */
    public static async createAgent(agentName: string): Promise<DextoAgent> {
        const agentRegistry = getAgentRegistry();

        try {
            // Resolve agent (will install if needed)
            const agentPath = await agentRegistry.resolveAgent(agentName, true, true);

            // Load agent configuration
            const config = await loadAgentConfig(agentPath);

            // Create new agent (not started)
            logger.info(`Creating agent: ${agentName}`);
            const newAgent = new DextoAgent(config, agentPath);

            logger.info(`Successfully created agent: ${agentName}`);
            return newAgent;
        } catch (error) {
            logger.error(
                `Failed to create agent '${agentName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            throw AgentError.apiValidationError(`Failed to create agent '${agentName}'`, error);
        }
    }

    // ============= MCP SAMPLING SUPPORT =============

    private async handleMcpSamplingRequest(
        params: CreateMessageRequest['params'],
        context: SamplingRequestContext
    ): Promise<CreateMessageResult> {
        this.ensureStarted();

        if (!this.sessionManager) {
            throw AgentError.initializationFailed('Session manager not initialized');
        }

        const normalized = this.normalizeSamplingRequest(params);
        if (!normalized.ok) {
            return normalized.result;
        }

        const session = await this.sessionManager.createSession();
        try {
            const { finalUserText, finalUserImage } = await this.prepareSamplingConversation(
                session,
                normalized.request
            );

            await this.applySamplingOverrides(session, normalized.request);

            const timeoutMs = this.resolveSamplingTimeout(normalized.request.metadata);
            const responseText = await this.runWithSamplingTimeout(
                session,
                () => session.run(finalUserText, finalUserImage),
                timeoutMs
            );

            return this.buildSamplingSuccessResult(responseText, session);
        } catch (error) {
            return this.buildSamplingFailureResult(error, context);
        } finally {
            await this.cleanupSamplingSession(session);
        }
    }

    private normalizeSamplingRequest(
        params: CreateMessageRequest['params']
    ):
        | { ok: true; request: NormalizedSamplingRequest }
        | { ok: false; result: CreateMessageResult } {
        if (!params || !Array.isArray(params.messages) || params.messages.length === 0) {
            throw MCPError.protocolError('Sampling request must include at least one message');
        }

        const llmConfig = this.stateManager.getLLMConfig();
        if (!this.isSamplingReady(llmConfig)) {
            const reason = 'LLM provider is not fully configured (missing API key or credentials).';
            logger.warn(`Sampling request skipped: ${reason}`);
            return { ok: false, result: this.buildSamplingUnavailableResult(reason) };
        }

        const metadata = (params.metadata as Record<string, unknown> | undefined) ?? undefined;

        const providerValue = metadata?.['provider'];
        const modelValue = metadata?.['model'];
        const hintedModel = params.modelPreferences?.hints?.find((hint) => hint?.name)?.name;

        const overrides: NormalizedSamplingRequest['overrides'] = {};
        if (typeof providerValue === 'string') {
            overrides.provider = providerValue as LLMProvider;
        }
        if (typeof modelValue === 'string') {
            overrides.model = modelValue;
        }
        if (hintedModel) {
            overrides.hintedModel = hintedModel;
        }
        if (typeof params.temperature === 'number') {
            overrides.temperature = params.temperature;
        }
        if (typeof params.maxTokens === 'number') {
            overrides.maxTokens = params.maxTokens;
        }

        const request: NormalizedSamplingRequest = {
            messages: params.messages!,
            overrides,
        };

        if (params.systemPrompt && params.systemPrompt.trim()) {
            request.systemPrompt = params.systemPrompt.trim();
        }

        if (params.modelPreferences) {
            request.modelPreferences = params.modelPreferences;
        }

        if (metadata && Object.keys(metadata).length > 0) {
            request.metadata = metadata;
        }

        return { ok: true, request };
    }

    private async prepareSamplingConversation(
        session: ChatSession,
        request: NormalizedSamplingRequest
    ): Promise<{ finalUserText: string; finalUserImage?: { image: string; mimeType: string } }> {
        const contextManager = session.getContextManager();

        if (request.systemPrompt) {
            await contextManager.addMessage({ role: 'system', content: request.systemPrompt });
        }

        await contextManager.addMessage({
            role: 'system',
            content: SAMPLING_TOOL_BAN_PROMPT,
        });

        const lastUserIndexFromEnd = [...request.messages]
            .reverse()
            .findIndex((msg) => msg.role === 'user');
        const lastUserIndex =
            lastUserIndexFromEnd === -1 ? -1 : request.messages.length - 1 - lastUserIndexFromEnd;

        if (lastUserIndex === -1) {
            throw MCPError.protocolError('Sampling request must contain at least one user message');
        }

        let finalUserText = '';
        let finalUserImage: { image: string; mimeType: string } | undefined;

        for (let i = 0; i < request.messages.length; i++) {
            const message = request.messages[i]!;
            const { text, imageData } = this.normalizeSamplingMessageContent(message);

            if (i < lastUserIndex) {
                if (message.role === 'user') {
                    await contextManager.addUserMessage(text, imageData);
                } else if (message.role === 'assistant') {
                    await contextManager.addAssistantMessage(text ?? '');
                }
                continue;
            }

            if (i === lastUserIndex) {
                finalUserText = text;
                finalUserImage = imageData;
                continue;
            }

            if (message.role === 'assistant') {
                await contextManager.addAssistantMessage(text ?? '');
            } else if (message.role === 'user') {
                await contextManager.addUserMessage(text, imageData);
            }
        }

        return finalUserImage ? { finalUserText, finalUserImage } : { finalUserText };
    }

    private async applySamplingOverrides(
        session: ChatSession,
        request: NormalizedSamplingRequest
    ): Promise<void> {
        const updates: Partial<LLMUpdates> = {};

        if (typeof request.overrides.temperature === 'number') {
            updates.temperature = request.overrides.temperature;
        }

        if (typeof request.overrides.maxTokens === 'number') {
            updates.maxOutputTokens = request.overrides.maxTokens;
        }

        if (request.overrides.provider) {
            updates.provider = request.overrides.provider;
        }

        const effectiveModel = request.overrides.model ?? request.overrides.hintedModel;
        if (effectiveModel) {
            updates.model = effectiveModel;
        }

        if (Object.keys(updates).length === 0) {
            return;
        }

        const parsedUpdates = LLMUpdatesSchema.safeParse(updates);
        if (!parsedUpdates.success) {
            logger.warn(
                `Ignoring sampling overrides due to validation issues: ${parsedUpdates.error.issues
                    .map((issue) => issue.message)
                    .join(', ')}`
            );
            return;
        }

        const currentConfig = this.stateManager.getLLMConfig();
        const result = resolveAndValidateLLMConfig(currentConfig, parsedUpdates.data);

        try {
            const validatedConfig = ensureOk(result);
            await session.switchLLM(validatedConfig);

            const warnings = result.issues.filter((issue) => issue.severity === 'warning');
            if (warnings.length > 0) {
                logger.warn(
                    `Sampling overrides applied with warnings: ${warnings
                        .map((warning) => warning.message)
                        .join(', ')}`
                );
            }
        } catch (error) {
            logger.warn(
                `Failed to apply sampling overrides: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private resolveSamplingTimeout(metadata?: Record<string, unknown>): number {
        const requested =
            metadata && typeof metadata[SAMPLING_TIMEOUT_METADATA_KEY] === 'number'
                ? Number(metadata[SAMPLING_TIMEOUT_METADATA_KEY])
                : undefined;

        if (requested && Number.isFinite(requested) && requested > 0) {
            return Math.min(requested, SAMPLING_TIMEOUT_MAX_MS);
        }

        return SAMPLING_TIMEOUT_DEFAULT_MS;
    }

    private async runWithSamplingTimeout<T>(
        session: ChatSession,
        operation: () => Promise<T>,
        timeoutMs: number
    ): Promise<T> {
        let timeout: NodeJS.Timeout | undefined;
        const timeoutError = new Error(
            `Sampling timed out after ${Math.round(timeoutMs / 1000)} seconds`
        );

        try {
            return await Promise.race([
                operation(),
                new Promise<T>((_, reject) => {
                    timeout = setTimeout(() => {
                        session.cancel();
                        reject(timeoutError);
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    private buildSamplingSuccessResult(
        responseText: string,
        session: ChatSession
    ): CreateMessageResult {
        const llmInfo = session.getLLMService().getConfig();
        const modelId =
            (llmInfo.model as any)?.id ||
            (typeof llmInfo.model === 'string' ? llmInfo.model : 'unknown-model');

        return {
            model: modelId,
            role: 'assistant',
            stopReason: 'endTurn',
            content: {
                type: 'text',
                text: responseText,
            },
        };
    }

    private buildSamplingFailureResult(
        error: unknown,
        context: SamplingRequestContext
    ): CreateMessageResult {
        const message =
            error instanceof Error
                ? error.message
                : typeof error === 'string'
                  ? error
                  : 'Unknown error';
        logger.warn(`Sampling request for ${context.serverName} failed: ${message}`);

        return {
            model: 'sampling-error',
            role: 'assistant',
            stopReason: 'error',
            content: {
                type: 'text',
                text: `Sampling request failed: ${message}`,
            },
        };
    }

    private buildSamplingUnavailableResult(reason: string): CreateMessageResult {
        return {
            model: 'sampling-unavailable',
            role: 'assistant',
            stopReason: 'error',
            content: {
                type: 'text',
                text: `Sampling is unavailable: ${reason} Configure your LLM credentials (for example by setting OPENAI_API_KEY) to enable this capability.`,
            },
        };
    }

    private async cleanupSamplingSession(session: ChatSession): Promise<void> {
        try {
            await this.sessionManager.deleteSession(session.id);
        } catch (error) {
            logger.warn(
                `Failed to clean up sampling session ${session.id}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private normalizeSamplingMessageContent(
        message: CreateMessageRequest['params']['messages'][number]
    ): { text: string; imageData?: { image: string; mimeType: string } } {
        const content = message.content;

        if (!content) {
            return { text: '' };
        }

        switch (content.type) {
            case 'text':
                return { text: content.text ?? '' };
            case 'image':
                if (!content.data) {
                    throw MCPError.protocolError('Sampling image content is missing data');
                }
                return {
                    text: '',
                    imageData: {
                        image: `data:${content.mimeType ?? 'image/png'};base64,${content.data}`,
                        mimeType: content.mimeType ?? 'image/png',
                    },
                };
            default:
                throw MCPError.protocolError(`Unsupported sampling content type: ${content.type}`);
        }
    }

    private isSamplingReady(config: ValidatedLLMConfig): boolean {
        const explicitKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (explicitKey.length > 0) {
            return true;
        }

        const resolvedKey = resolveApiKeyForProvider(config.provider);
        return typeof resolvedKey === 'string' && resolvedKey.trim().length > 0;
    }

    // Future methods could encapsulate more complex agent behaviors:
    // - Multi-step task execution with progress tracking
    // - Memory and context management across sessions
    // - Tool chaining and workflow automation
    // - Agent collaboration and delegation
}

// (resource methods are defined on the class above; no interface augmentation required)
