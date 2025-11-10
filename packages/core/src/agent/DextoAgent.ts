// src/agent/DextoAgent.ts
import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ResourceManager, expandMessageReferences } from '../resources/index.js';
import { expandBlobReferences } from '../context/utils.js';
import { PromptManager } from '../prompts/index.js';
import { AgentStateManager } from './state-manager.js';
import { SessionManager, ChatSession, SessionError } from '../session/index.js';
import type { SessionMetadata } from '../session/index.js';
import { AgentServices } from '../utils/service-initializer.js';
import { logger } from '../logger/index.js';
import { Telemetry } from '../telemetry/telemetry.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import { trace, context, propagation, type BaggageEntry } from '@opentelemetry/api';
import { ValidatedLLMConfig, LLMUpdates, LLMUpdatesSchema } from '@core/llm/schemas.js';
import { resolveAndValidateLLMConfig } from '../llm/resolver.js';
import { validateInputForLLM } from '../llm/validation.js';
import { AgentError } from './errors.js';
import { MCPError } from '../mcp/errors.js';
import { ensureOk } from '@core/errors/result-bridge.js';
import { fail, zodToIssues } from '@core/utils/result.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
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
import { loadAgentConfig } from '../config/loader.js';
import { promises as fs } from 'fs';
import { parseDocument } from 'yaml';
import { deriveHeuristicTitle, generateSessionTitle } from '../session/title-generator.js';

const requiredServices: (keyof AgentServices)[] = [
    'mcpManager',
    'toolManager',
    'systemPromptManager',
    'agentEventBus',
    'stateManager',
    'sessionManager',
    'searchService',
    'memoryManager',
];

/**
 * Interface for objects that can subscribe to the agent's event bus.
 * Typically used by API layer subscribers (WebSocket, Webhooks, etc.)
 */
export interface AgentEventSubscriber {
    subscribe(eventBus: AgentEventBus): void;
}

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
 * await agent.switchLLM({ model: 'gpt-5' });
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
@InstrumentClass({
    prefix: 'agent',
    excludeMethods: [
        'isStarted',
        'isStopped',
        'getConfig',
        'getEffectiveConfig',
        'registerSubscriber',
        'ensureStarted',
    ],
})
export class DextoAgent {
    /**
     * These services are public for use by the outside world
     * This gives users the option to use methods of the services directly if they know what they are doing
     * But the main recommended entry points/functions would still be the wrapper methods we define below
     */
    public readonly mcpManager!: MCPManager;
    public readonly systemPromptManager!: SystemPromptManager;
    public readonly agentEventBus!: AgentEventBus;
    public readonly promptManager!: PromptManager;
    public readonly stateManager!: AgentStateManager;
    public readonly sessionManager!: SessionManager;
    public readonly toolManager!: ToolManager;
    public readonly resourceManager!: ResourceManager;
    public readonly memoryManager!: import('../memory/index.js').MemoryManager;
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

    // Event subscribers (e.g., WebSocket, Webhook handlers)
    private eventSubscribers: Set<AgentEventSubscriber> = new Set();

    // Telemetry instance for distributed tracing
    private telemetry?: Telemetry;

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
            // Note: createAgentServices handles agentId derivation internally
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
                memoryManager: services.memoryManager,
                services: services,
            });

            // Initialize search service from services
            this.searchService = services.searchService;

            // Initialize prompts manager (aggregates MCP, internal, starter prompts)
            // File prompts automatically resolve custom slash commands
            const promptManager = new PromptManager(
                this.mcpManager,
                this.resourceManager,
                this.config,
                this.agentEventBus,
                services.storageManager.getDatabase()
            );
            await promptManager.initialize();
            Object.assign(this, { promptManager });

            // Note: Telemetry is initialized in createAgentServices() before services are created
            // This ensures decorators work correctly on all services

            this._isStarted = true;
            this._isStopped = false; // Reset stopped flag to allow restart
            logger.info('DextoAgent started successfully.');

            // Subscribe all registered event subscribers to the new event bus
            for (const subscriber of this.eventSubscribers) {
                subscriber.subscribe(this.agentEventBus);
            }

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

            // 2. Clean up plugins (close file handles, connections, etc.)
            // Do this before storage disconnect so plugins can flush state if needed
            try {
                if (this.services?.pluginManager) {
                    await this.services.pluginManager.cleanup();
                    logger.debug('PluginManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`PluginManager cleanup failed: ${err.message}`));
            }

            // 3. Disconnect all MCP clients
            try {
                if (this.mcpManager) {
                    await this.mcpManager.disconnectAll();
                    logger.debug('MCPManager disconnected all clients successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`MCPManager disconnect failed: ${err.message}`));
            }

            // 4. Close storage backends
            try {
                if (this.services?.storageManager) {
                    await this.services.storageManager.disconnect();
                    logger.debug('Storage manager disconnected successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`Storage disconnect failed: ${err.message}`));
            }

            // Note: Telemetry is NOT shut down here
            // For agent switching: Telemetry.shutdownGlobal() is called explicitly before creating new agent
            // For process exit: Telemetry shuts down automatically via process exit handlers
            // This allows telemetry to persist across agent restarts in the same process

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
     * Register an event subscriber that will be automatically re-subscribed on agent restart.
     * Subscribers are typically API layer components (WebSocket, Webhook handlers) that need
     * to receive agent events. If the agent is already started, the subscriber is immediately subscribed.
     *
     * @param subscriber - Object implementing AgentEventSubscriber interface
     */
    public registerSubscriber(subscriber: AgentEventSubscriber): void {
        this.eventSubscribers.add(subscriber);
        if (this._isStarted) {
            subscriber.subscribe(this.agentEventBus);
        }
    }

    /**
     * Restart the agent by stopping and starting it.
     * Automatically re-subscribes all registered event subscribers to the new event bus.
     * This is useful when configuration changes require a full agent restart.
     *
     * @throws Error if restart fails during stop or start phases
     */
    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
        // Note: start() handles re-subscribing all registered subscribers
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

        // Determine target session ID for validation
        const targetSessionId = sessionId || this.currentDefaultSessionId;

        // Propagate sessionId through OpenTelemetry context for distributed tracing
        // This ensures all child spans will have access to the sessionId
        const activeContext = context.active();
        const span = trace.getActiveSpan();

        // Add sessionId to span attributes
        if (span) {
            span.setAttribute('sessionId', targetSessionId);
        }

        // Preserve existing baggage entries and add sessionId
        const existingBaggage = propagation.getBaggage(activeContext);
        const baggageEntries: Record<string, BaggageEntry> = {};

        // Copy existing baggage entries to preserve them (including metadata)
        if (existingBaggage) {
            existingBaggage.getAllEntries().forEach(([key, entry]) => {
                baggageEntries[key] = { ...entry };
            });
        }

        // Add or update sessionId while preserving any existing metadata
        baggageEntries.sessionId = { ...baggageEntries.sessionId, value: targetSessionId };

        // Create updated context with merged baggage
        const updatedContext = propagation.setBaggage(
            activeContext,
            propagation.createBaggage(baggageEntries)
        );

        // Debug logging to verify baggage propagation
        const verifyBaggage = propagation.getBaggage(updatedContext);
        logger.debug(
            `Baggage after setting sessionId: ${JSON.stringify(
                Array.from(verifyBaggage?.getAllEntries() || [])
            )}`
        );

        // Execute the rest of the method within the updated context
        return await context.with(updatedContext, async () => {
            try {
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
                    try {
                        const resources = await this.resourceManager.list();
                        const expansion = await expandMessageReferences(
                            textInput,
                            resources,
                            (uri) => this.resourceManager.read(uri)
                        );

                        // Warn about unresolved references
                        if (expansion.unresolvedReferences.length > 0) {
                            const unresolvedNames = expansion.unresolvedReferences
                                .map((ref) => ref.originalRef)
                                .join(', ');
                            logger.warn(
                                `Could not resolve ${expansion.unresolvedReferences.length} resource reference(s): ${unresolvedNames}`
                            );
                        }

                        // Validate expanded message size (5MB limit)
                        const MAX_EXPANDED_SIZE = 5 * 1024 * 1024; // 5MB
                        const expandedSize = Buffer.byteLength(expansion.expandedMessage, 'utf-8');
                        if (expandedSize > MAX_EXPANDED_SIZE) {
                            logger.warn(
                                `Expanded message size (${(expandedSize / 1024 / 1024).toFixed(2)}MB) exceeds limit (${MAX_EXPANDED_SIZE / 1024 / 1024}MB). Content may be truncated.`
                            );
                        }

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
                    } catch (error) {
                        // Log error but continue with original message to avoid blocking the user
                        logger.error(
                            `Failed to expand resource references: ${error instanceof Error ? error.message : String(error)}. Continuing with original message.`
                        );
                        // Continue with original text instead of throwing
                    }
                }

                // Validate that we have either text or media content after expansion
                if (!finalText.trim() && !finalImageData && !fileDataInput) {
                    logger.warn(
                        'Resource expansion resulted in empty content. Using original message.'
                    );
                    finalText = textInput;
                }

                // Kick off background title generation for first turn if needed
                void this.maybeGenerateTitle(targetSessionId, finalText, llmConfig);

                const response = await session.run(
                    finalText,
                    finalImageData,
                    fileDataInput,
                    stream
                );

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
        });
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
     * Sets a human-friendly title for the given session.
     */
    public async setSessionTitle(sessionId: string, title: string): Promise<void> {
        this.ensureStarted();
        await this.sessionManager.setSessionTitle(sessionId, title);
    }

    /**
     * Gets the human-friendly title for the given session, if any.
     */
    public async getSessionTitle(sessionId: string): Promise<string | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSessionTitle(sessionId);
    }

    /**
     * Background task: generate and persist a session title using the same LLM.
     * Runs only for the first user message (messageCount === 0 and no existing title).
     * Never throws; timeboxed in the generator.
     */
    private async maybeGenerateTitle(
        sessionId: string,
        userText: string,
        llmConfig: ValidatedLLMConfig
    ): Promise<void> {
        try {
            const metadata = await this.sessionManager.getSessionMetadata(sessionId);
            if (!metadata) {
                logger.debug(
                    `[SessionTitle] No session metadata available for ${sessionId}, skipping title generation`
                );
                return;
            }
            if (metadata.title) {
                logger.debug(
                    `[SessionTitle] Session ${sessionId} already has title '${metadata.title}', skipping`
                );
                return;
            }
            if (!userText || !userText.trim()) {
                logger.debug(
                    `[SessionTitle] User text empty for session ${sessionId}, skipping title generation`
                );
                return;
            }

            logger.debug(
                `[SessionTitle] Checking title generation preconditions for session ${sessionId}`
            );
            const result = await generateSessionTitle(
                llmConfig,
                llmConfig.router,
                this.toolManager,
                this.systemPromptManager,
                this.resourceManager,
                userText
            );
            if (result.error) {
                logger.debug(
                    `[SessionTitle] LLM title generation failed for ${sessionId}: ${result.error}${
                        result.timedOut ? ' (timeout)' : ''
                    }`
                );
            }

            let title = result.title;
            if (!title) {
                title = deriveHeuristicTitle(userText);
                if (title) {
                    logger.info(`[SessionTitle] Using heuristic title for ${sessionId}: ${title}`);
                } else {
                    logger.debug(
                        `[SessionTitle] No suitable title derived for session ${sessionId}`
                    );
                    return;
                }
            } else {
                logger.info(`[SessionTitle] Generated LLM title for ${sessionId}: ${title}`);
            }

            await this.sessionManager.setSessionTitle(sessionId, title, { ifUnsetOnly: true });
            this.agentEventBus.emit('dexto:sessionTitleUpdated', { sessionId, title });
        } catch (err) {
            // Swallow background errors – never impact main flow
            logger.silly(`Title generation skipped/failed for ${sessionId}: ${String(err)}`);
        }
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
                content: await expandBlobReferences(message.content, this.resourceManager).catch(
                    (error) => {
                        logger.warn(
                            `Failed to expand blob references in message: ${error instanceof Error ? error.message : String(error)}`
                        );
                        return message.content; // Return original content on error
                    }
                ),
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
    public getCurrentLLMConfig(): ValidatedLLMConfig {
        this.ensureStarted();
        return structuredClone(this.stateManager.getLLMConfig());
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
     * await agent.switchLLM({ model: 'gpt-5' });
     *
     * // Switch to a different provider with explicit API key
     * await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514', apiKey: 'sk-ant-...' });
     *
     * // Switch with router and session options
     * await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514', router: 'in-built' }, 'user-123');
     *
     * // Switch for all sessions
     * await agent.switchLLM({ model: 'gpt-5' }, '*');
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
     * const provider = agent.inferProviderFromModel('gpt-5');
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
     * Restarts an MCP server by disconnecting and reconnecting with its original configuration.
     * This is useful for recovering from server errors or applying configuration changes.
     * @param name The name of the server to restart.
     * @throws MCPError if server is not found or restart fails
     */
    public async restartMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        try {
            logger.info(`DextoAgent: Restarting MCP server '${name}'...`);

            // Restart the server using MCPManager
            await this.mcpManager.restartServer(name);

            // Refresh tool cache after restart so the LLM sees updated toolset
            await this.toolManager.refresh();

            this.agentEventBus.emit('dexto:mcpServerRestarted', {
                serverName: name,
            });
            this.agentEventBus.emit('dexto:availableToolsUpdated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            logger.info(`DextoAgent: Successfully restarted MCP server '${name}'.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`DextoAgent: Failed to restart MCP server '${name}': ${errorMessage}`);

            // Note: No event emitted on failure since the error is thrown
            // The calling layer (API) will handle error reporting

            throw error;
        }
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

    /**
     * Lists all available prompts from all providers (MCP, internal, starter, custom).
     * @returns Promise resolving to a PromptSet with all available prompts
     */
    public async listPrompts(): Promise<import('../prompts/index.js').PromptSet> {
        this.ensureStarted();
        return await this.promptManager.list();
    }

    /**
     * Gets the definition of a specific prompt by name.
     * @param name The name of the prompt
     * @returns Promise resolving to the prompt definition or null if not found
     */
    public async getPromptDefinition(
        name: string
    ): Promise<import('../prompts/index.js').PromptDefinition | null> {
        this.ensureStarted();
        return await this.promptManager.getPromptDefinition(name);
    }

    /**
     * Checks if a prompt exists.
     * @param name The name of the prompt to check
     * @returns Promise resolving to true if the prompt exists, false otherwise
     */
    public async hasPrompt(name: string): Promise<boolean> {
        this.ensureStarted();
        return await this.promptManager.has(name);
    }

    /**
     * Gets a prompt with its messages.
     * @param name The name of the prompt
     * @param args Optional arguments to pass to the prompt
     * @returns Promise resolving to the prompt result with messages
     */
    public async getPrompt(
        name: string,
        args?: Record<string, unknown>
    ): Promise<import('@modelcontextprotocol/sdk/types.js').GetPromptResult> {
        this.ensureStarted();
        return await this.promptManager.getPrompt(name, args);
    }

    /**
     * Creates a new custom prompt.
     * @param input The prompt creation input
     * @returns Promise resolving to the created prompt info
     */
    public async createCustomPrompt(
        input: import('../prompts/index.js').CreateCustomPromptInput
    ): Promise<import('../prompts/index.js').PromptInfo> {
        this.ensureStarted();
        return await this.promptManager.createCustomPrompt(input);
    }

    /**
     * Deletes a custom prompt by name.
     * @param name The name of the custom prompt to delete
     */
    public async deleteCustomPrompt(name: string): Promise<void> {
        this.ensureStarted();
        return await this.promptManager.deleteCustomPrompt(name);
    }

    /**
     * Resolves a prompt to its text content with all arguments applied.
     * This is a high-level method that handles:
     * - Prompt key resolution (resolving aliases)
     * - Argument normalization (including special _context field)
     * - Prompt execution and flattening
     *
     * @param name The prompt name or alias
     * @param options Optional configuration for prompt resolution
     * @returns Promise resolving to the resolved text and resource URIs
     */
    public async resolvePrompt(
        name: string,
        options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {}
    ): Promise<{ text: string; resources: string[] }> {
        this.ensureStarted();
        return await this.promptManager.resolvePrompt(name, options);
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

    /**
     * Gets the file path of the agent configuration currently in use.
     * This returns the source agent file path, not session-specific overrides.
     * @returns The path to the agent configuration file
     * @throws AgentError if no config path is available
     */
    public getAgentFilePath(): string {
        if (!this.configPath) {
            throw AgentError.noConfigPath();
        }
        return this.configPath;
    }

    /**
     * Reloads the agent configuration from disk.
     * This will re-read the config file, validate it, and detect what changed.
     * Most configuration changes require a full agent restart to take effect.
     *
     * To apply changes: stop the agent and start it again with the new config.
     *
     * @returns Object containing list of changes that require restart
     * @throws Error if config file cannot be read or is invalid
     *
     * TODO: improve hot reload capabilites so that we don't always require a restart
     */
    public async reloadConfig(): Promise<{
        restartRequired: string[];
    }> {
        if (!this.configPath) {
            throw AgentError.noConfigPath();
        }

        logger.info(`Reloading agent configuration from: ${this.configPath}`);

        const oldConfig = this.config;
        const newConfig = await loadAgentConfig(this.configPath);
        const validated = AgentConfigSchema.parse(newConfig);

        // Detect what changed
        const restartRequired = this.detectRestartRequiredChanges(oldConfig, validated);

        // Update the config reference (but services won't pick up changes until restart)
        this.config = validated;

        if (restartRequired.length > 0) {
            logger.warn(
                `Configuration updated. Restart required to apply: ${restartRequired.join(', ')}`
            );
        } else {
            logger.info('Agent configuration reloaded successfully (no changes detected)');
        }

        return {
            restartRequired,
        };
    }

    /**
     * Updates and saves the agent configuration to disk.
     * This merges the updates with the raw config from disk, validates, and writes to file.
     * IMPORTANT: This preserves environment variable placeholders (e.g., $OPENAI_API_KEY)
     * to avoid leaking secrets into the config file.
     * @param updates Partial configuration updates to apply
     * @param targetPath Optional path to save to (defaults to current config path)
     * @returns Object containing list of changes that require restart
     * @throws Error if validation fails or file cannot be written
     */
    public async updateAndSaveConfig(
        updates: Partial<AgentConfig>,
        targetPath?: string
    ): Promise<{
        restartRequired: string[];
    }> {
        const path = targetPath || this.configPath;

        if (!path) {
            throw AgentError.noConfigPath();
        }

        logger.info(`Updating and saving agent configuration to: ${path}`);

        // Read raw YAML from disk (without env var expansion)
        const rawYaml = await fs.readFile(path, 'utf-8');

        // Use YAML Document API to preserve comments/anchors/formatting
        const doc = parseDocument(rawYaml);
        const rawConfig = doc.toJSON() as Record<string, unknown>;

        // Shallow merge top-level updates
        const updatedRawConfig = { ...rawConfig, ...updates };

        // Validate merged config using Result helpers
        const parsed = AgentConfigSchema.safeParse(updatedRawConfig);
        if (!parsed.success) {
            // Convert Zod errors to DextoValidationError using Result helpers
            const result = fail(zodToIssues(parsed.error, 'error'));
            throw new DextoValidationError(result.issues);
        }

        // Apply updates to the YAML document (preserves formatting/comments)
        for (const [key, value] of Object.entries(updates)) {
            doc.set(key, value);
        }

        // Serialize the Document back to YAML
        const yamlContent = String(doc);

        // Atomic write: write to temp file then rename
        const tmpPath = `${path}.tmp`;
        await fs.writeFile(tmpPath, yamlContent, 'utf-8');
        await fs.rename(tmpPath, path);

        // Reload config with env var expansion for runtime use (this applies hot reload)
        const reloadResult = await this.reloadConfig();

        logger.info(`Agent configuration saved to: ${path}`);

        return reloadResult;
    }

    /**
     * Detects configuration changes that require a full agent restart.
     * Returns an array of change descriptions.
     *
     * @param oldConfig Previous validated configuration
     * @param newConfig New validated configuration
     * @returns Array of restart-required change descriptions
     * @private
     */
    private detectRestartRequiredChanges(
        oldConfig: ValidatedAgentConfig,
        newConfig: ValidatedAgentConfig
    ): string[] {
        const changes: string[] = [];

        // Storage backend changes require restart
        if (JSON.stringify(oldConfig.storage) !== JSON.stringify(newConfig.storage)) {
            changes.push('Storage backend');
        }

        // Session config changes require restart (maxSessions, sessionTTL are readonly)
        if (JSON.stringify(oldConfig.sessions) !== JSON.stringify(newConfig.sessions)) {
            changes.push('Session configuration');
        }

        // System prompt changes require restart (PromptManager caches contributors)
        if (JSON.stringify(oldConfig.systemPrompt) !== JSON.stringify(newConfig.systemPrompt)) {
            changes.push('System prompt');
        }

        // Tool confirmation changes require restart (ConfirmationProvider caches config)
        if (
            JSON.stringify(oldConfig.toolConfirmation) !==
            JSON.stringify(newConfig.toolConfirmation)
        ) {
            changes.push('Tool confirmation');
        }

        // Internal tools changes require restart (InternalToolsProvider caches config)
        if (JSON.stringify(oldConfig.internalTools) !== JSON.stringify(newConfig.internalTools)) {
            changes.push('Internal tools');
        }

        // MCP server changes require restart
        if (JSON.stringify(oldConfig.mcpServers) !== JSON.stringify(newConfig.mcpServers)) {
            changes.push('MCP servers');
        }

        // LLM configuration changes require restart
        if (
            oldConfig.llm.provider !== newConfig.llm.provider ||
            oldConfig.llm.model !== newConfig.llm.model ||
            oldConfig.llm.apiKey !== newConfig.llm.apiKey
        ) {
            changes.push('LLM configuration');
        }

        return changes;
    }

    // ============= AGENT MANAGEMENT =============
    // Note: Agent management methods have been moved to the Dexto orchestrator class.
    // See: /packages/core/src/Dexto.ts
    //
    // For agent lifecycle operations (list, install, uninstall, create), use:
    // ```typescript
    // await Dexto.listAgents();                 // Static
    // await Dexto.installAgent(name);           // Static
    // await Dexto.installCustomAgent(name, path, metadata); // Static
    // await Dexto.uninstallAgent(name);         // Static
    //
    // const dexto = new Dexto();
    // await dexto.createAgent(name);            // Instance method
    // ```

    // Future methods could encapsulate more complex agent behaviors:
    // - Multi-step task execution with progress tracking
    // - Memory and context management across sessions
    // - Tool chaining and workflow automation
    // - Agent collaboration and delegation
}
