import { createDatabaseHistoryProvider } from './history/factory.js';
import { createLLMService, createVercelModel } from '../llm/services/factory.js';
import { createCompactionStrategy } from '../context/compaction/index.js';
import type { ContextManager } from '@core/context/index.js';
import type { IConversationHistoryProvider } from './history/types.js';
import type { VercelLLMService } from '../llm/services/vercel.js';
import type { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ValidatedLLMConfig } from '@core/llm/schemas.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { StorageManager } from '../storage/index.js';
import type { PluginManager } from '../plugins/manager.js';
import type { MCPManager } from '../mcp/manager.js';
import type { BeforeLLMRequestPayload, BeforeResponsePayload } from '../plugins/types.js';
import {
    SessionEventBus,
    AgentEventBus,
    SessionEventNames,
    SessionEventName,
    SessionEventMap,
} from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { PluginErrorCode } from '../plugins/error-codes.js';
import type { InternalMessage, ContentPart } from '../context/types.js';
import type { UserMessageInput } from './message-queue.js';
import type { ContentInput } from '../agent/types.js';
import { getModelPricing, calculateCost } from '../llm/registry/index.js';

/**
 * Represents an isolated conversation session within a Dexto agent.
 *
 * ChatSession provides session-level isolation for conversations, allowing multiple
 * independent chat contexts to exist within a single DextoAgent instance. Each session
 * maintains its own conversation history, message management, and event handling.
 *
 * ## Architecture
 *
 * The ChatSession acts as a lightweight wrapper around core Dexto services, providing
 * session-specific instances of:
 * - **ContextManager**: Handles conversation history and message formatting
 * - **LLMService**: Manages AI model interactions and tool execution
 * - **TypedEventEmitter**: Provides session-scoped event handling
 *
 * ## Event Handling
 *
 * Each session has its own event bus that emits standard Dexto events:
 * - `llm:*` events (thinking, toolCall, response, etc.)
 *
 * Session events are forwarded to the global agent event bus with session prefixes.
 *
 * ## Usage Example
 *
 * ```typescript
 * // Create a new session
 * const session = agent.createSession('user-123');
 *
 * // Listen for session events
 * session.eventBus.on('llm:response', (payload) => {
 *   console.log('Session response:', payload.content);
 * });
 *
 * // Run a conversation turn
 * const response = await session.run('Hello, how are you?');
 *
 * // Reset session history
 * await session.reset();
 * ```
 *
 * @see {@link SessionManager} for session lifecycle management
 * @see {@link ContextManager} for conversation history management
 * @see {@link VercelLLMService} for AI model interaction
 */
export class ChatSession {
    /**
     * Session-scoped event emitter for handling conversation events.
     *
     * This is a session-local SessionEventBus instance that forwards events
     * to the global agent event bus.
     *
     * Events emitted include:
     * - `llm:thinking` - AI model is processing
     * - `llm:tool-call` - Tool execution requested
     * - `llm:response` - Final response generated
     */
    public readonly eventBus: SessionEventBus;

    /**
     * History provider that persists conversation messages.
     * Shared across LLM switches to maintain conversation continuity.
     */
    private historyProvider!: IConversationHistoryProvider;

    /**
     * Handles AI model interactions, tool execution, and response generation for this session.
     *
     * Each session has its own LLMService instance that uses the session's
     * ContextManager and event bus.
     */
    private llmService!: VercelLLMService;

    /**
     * Map of event forwarder functions for cleanup.
     * Stores the bound functions so they can be removed from the event bus.
     */
    private forwarders: Map<SessionEventName, (payload?: any) => void> = new Map();

    /**
     * Token accumulator listener for cleanup.
     */
    private tokenAccumulatorListener: ((payload: SessionEventMap['llm:response']) => void) | null =
        null;

    /**
     * AbortController for the currently running turn, if any.
     * Calling cancel() aborts the in-flight LLM request and tool execution checks.
     */
    private currentRunController: AbortController | null = null;

    public readonly logger: IDextoLogger;

    /**
     * Creates a new ChatSession instance.
     *
     * Each session creates its own isolated services:
     * - ConversationHistoryProvider (with session-specific storage, shared across LLM switches)
     * - LLMService (creates its own properly-typed ContextManager internally)
     * - SessionEventBus (session-local event handling with forwarding)
     *
     * @param services - The shared services from the agent (state manager, prompt, client managers, etc.)
     * @param id - Unique identifier for this session
     * @param logger - Logger instance for dependency injection
     */
    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            agentEventBus: AgentEventBus;
            storageManager: StorageManager;
            resourceManager: import('../resources/index.js').ResourceManager;
            pluginManager: PluginManager;
            mcpManager: MCPManager;
            sessionManager: import('./session-manager.js').SessionManager;
        },
        public readonly id: string,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
        // Create session-specific event bus
        this.eventBus = new SessionEventBus();

        // Set up event forwarding to agent's global bus
        this.setupEventForwarding();

        // Services will be initialized in init() method due to async requirements
        this.logger.debug(`ChatSession ${this.id}: Created, awaiting initialization`);
    }

    /**
     * Initialize the session services asynchronously.
     * This must be called after construction to set up the storage-backed services.
     */
    public async init(): Promise<void> {
        await this.initializeServices();
    }

    /**
     * Sets up event forwarding from session bus to global agent bus.
     *
     * All session events are automatically forwarded to the global bus with the same
     * event names, but with session context added to the payload. This allows the app
     * layer to continue listening to standard events while having access to session
     * information when needed.
     */
    private setupEventForwarding(): void {
        // Forward each session event type to the agent bus with session context
        SessionEventNames.forEach((eventName) => {
            const forwarder = (payload?: any) => {
                // Create payload with sessionId - handle both void and object payloads
                const payloadWithSession =
                    payload && typeof payload === 'object'
                        ? { ...payload, sessionId: this.id }
                        : { sessionId: this.id };
                // Forward to agent bus with session context
                this.services.agentEventBus.emit(eventName as any, payloadWithSession);
            };

            // Store the forwarder function for later cleanup
            this.forwarders.set(eventName, forwarder);

            // Attach the forwarder to the session event bus
            this.eventBus.on(eventName, forwarder);
        });

        // Set up token usage accumulation on llm:response
        this.setupTokenAccumulation();

        this.logger.debug(
            `[setupEventForwarding] Event forwarding setup complete for session=${this.id}`
        );
    }

    /**
     * Sets up token usage accumulation by listening to llm:response events.
     * Accumulates token usage and cost to session metadata for /stats tracking.
     */
    private setupTokenAccumulation(): void {
        this.tokenAccumulatorListener = (payload: SessionEventMap['llm:response']) => {
            if (payload.tokenUsage) {
                const llmConfig = this.services.stateManager.getLLMConfig(this.id);

                // Extract model info from payload (preferred) or fall back to config
                const modelInfo = {
                    provider: payload.provider ?? llmConfig.provider,
                    model: payload.model ?? llmConfig.model,
                };

                // Calculate cost if pricing is available (using the actual model from payload)
                let cost: number | undefined;
                const pricing = getModelPricing(modelInfo.provider, modelInfo.model);
                if (pricing) {
                    cost = calculateCost(payload.tokenUsage, pricing);
                }

                // Fire and forget - don't block the event flow
                this.services.sessionManager
                    .accumulateTokenUsage(this.id, payload.tokenUsage, cost, modelInfo)
                    .catch((err) => {
                        this.logger.warn(
                            `Failed to accumulate token usage: ${err instanceof Error ? err.message : String(err)}`
                        );
                    });
            }
        };

        this.eventBus.on('llm:response', this.tokenAccumulatorListener);
    }

    /**
     * Initializes session-specific services.
     */
    private async initializeServices(): Promise<void> {
        // Get current effective configuration for this session from state manager
        const runtimeConfig = this.services.stateManager.getRuntimeConfig(this.id);
        const llmConfig = runtimeConfig.llm;

        // Create session-specific history provider directly with database backend
        // This persists across LLM switches to maintain conversation history
        this.historyProvider = createDatabaseHistoryProvider(
            this.services.storageManager.getDatabase(),
            this.id,
            this.logger
        );

        // Create model and compaction strategy from config
        const model = createVercelModel(llmConfig);
        const compactionStrategy = await createCompactionStrategy(runtimeConfig.compaction, {
            logger: this.logger,
            model,
        });

        // Create session-specific LLM service
        // The service will create its own properly-typed ContextManager internally
        this.llmService = createLLMService(
            llmConfig,
            this.services.toolManager,
            this.services.systemPromptManager,
            this.historyProvider, // Pass history provider for service to use
            this.eventBus, // Use session event bus
            this.id,
            this.services.resourceManager, // Pass ResourceManager for blob storage
            this.logger, // Pass logger for dependency injection
            compactionStrategy, // Pass compaction strategy
            runtimeConfig.compaction // Pass compaction config for threshold settings
        );

        this.logger.debug(`ChatSession ${this.id}: Services initialized with storage`);
    }

    /**
     * Saves a blocked interaction to history when a plugin blocks execution.
     * This ensures that even when a plugin blocks execution (e.g., due to abusive language),
     * the user's message and the error response are preserved in the conversation history.
     *
     * @param userInput - The user's text input that was blocked
     * @param errorMessage - The error message explaining why execution was blocked
     * @param imageData - Optional image data that was part of the blocked message
     * @param fileData - Optional file data that was part of the blocked message
     * @private
     */
    private async saveBlockedInteraction(
        userInput: string,
        errorMessage: string,
        _imageData?: { image: string; mimeType: string },
        _fileData?: { data: string; mimeType: string; filename?: string }
    ): Promise<void> {
        // Create redacted user message (do not persist sensitive content or attachments)
        // When content is blocked by policy (abusive language, inappropriate content, etc.),
        // we shouldn't store the original content to comply with data minimization principles
        const userMessage: InternalMessage = {
            role: 'user',
            content: [{ type: 'text', text: '[Blocked by content policy: input redacted]' }],
        };

        // Create assistant error message
        const errorContent = `Error: ${errorMessage}`;
        const assistantMessage: InternalMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: errorContent }],
        };

        // Add both messages to history
        await this.historyProvider.saveMessage(userMessage);
        await this.historyProvider.saveMessage(assistantMessage);

        // Emit response event so UI updates immediately on blocked interactions
        // This ensures listeners relying on llm:response know a response was added
        // Note: sessionId is automatically added by event forwarding layer
        const llmConfig = this.services.stateManager.getLLMConfig(this.id);
        this.eventBus.emit('llm:response', {
            content: errorContent,
            provider: llmConfig.provider,
            model: llmConfig.model,
        });
    }

    /**
     * Stream a response for the given content.
     * Primary method for running conversations with multi-image support.
     *
     * @param content - String or ContentPart[] (text, images, files)
     * @param options - { signal?: AbortSignal }
     * @returns Promise that resolves to object with text response
     *
     * @example
     * ```typescript
     * // Text only
     * const { text } = await session.stream('What is the weather?');
     *
     * // Multiple images
     * const { text } = await session.stream([
     *     { type: 'text', text: 'Compare these images' },
     *     { type: 'image', image: base64Data1, mimeType: 'image/png' },
     *     { type: 'image', image: base64Data2, mimeType: 'image/png' }
     * ]);
     * ```
     */
    public async stream(
        content: ContentInput,
        options?: { signal?: AbortSignal }
    ): Promise<{ text: string }> {
        // Normalize content to ContentPart[]
        const parts: ContentPart[] =
            typeof content === 'string' ? [{ type: 'text', text: content }] : content;

        // Extract text for logging (no sensitive content)
        const textParts = parts.filter(
            (p): p is { type: 'text'; text: string } => p.type === 'text'
        );
        const imageParts = parts.filter((p) => p.type === 'image');
        const fileParts = parts.filter((p) => p.type === 'file');

        this.logger.debug(
            `Streaming session ${this.id} | textParts=${textParts.length} | images=${imageParts.length} | files=${fileParts.length}`
        );

        // Create an AbortController for this run and expose for cancellation
        this.currentRunController = new AbortController();
        const signal = options?.signal
            ? this.combineSignals(options.signal, this.currentRunController.signal)
            : this.currentRunController.signal;

        try {
            // Execute beforeLLMRequest plugins
            // For backward compatibility, extract first image/file for plugin payload
            const textContent = textParts.map((p) => p.text).join('\n');
            const firstImage = imageParts[0] as
                | { type: 'image'; image: string; mimeType?: string }
                | undefined;
            const firstFile = fileParts[0] as
                | { type: 'file'; data: string; mimeType: string; filename?: string }
                | undefined;

            const beforeLLMPayload: BeforeLLMRequestPayload = {
                text: textContent,
                ...(firstImage && {
                    imageData: {
                        image: typeof firstImage.image === 'string' ? firstImage.image : '[binary]',
                        mimeType: firstImage.mimeType || 'image/jpeg',
                    },
                }),
                ...(firstFile && {
                    fileData: {
                        data: typeof firstFile.data === 'string' ? firstFile.data : '[binary]',
                        mimeType: firstFile.mimeType,
                        ...(firstFile.filename && { filename: firstFile.filename }),
                    },
                }),
                sessionId: this.id,
            };

            const modifiedBeforePayload = await this.services.pluginManager.executePlugins(
                'beforeLLMRequest',
                beforeLLMPayload,
                {
                    sessionManager: this.services.sessionManager,
                    mcpManager: this.services.mcpManager,
                    toolManager: this.services.toolManager,
                    stateManager: this.services.stateManager,
                    sessionId: this.id,
                    abortSignal: signal,
                }
            );

            // Apply plugin text modifications to the first text part
            let modifiedParts = [...parts];
            if (modifiedBeforePayload.text !== textContent && textParts.length > 0) {
                // Replace text parts with modified text
                modifiedParts = modifiedParts.filter((p) => p.type !== 'text');
                modifiedParts.unshift({ type: 'text', text: modifiedBeforePayload.text });
            }

            // Call LLM service stream
            const streamResult = await this.llmService.stream(modifiedParts, { signal });

            // Execute beforeResponse plugins
            const llmConfig = this.services.stateManager.getLLMConfig(this.id);
            const beforeResponsePayload: BeforeResponsePayload = {
                content: streamResult.text,
                provider: llmConfig.provider,
                model: llmConfig.model,
                sessionId: this.id,
            };

            const modifiedResponsePayload = await this.services.pluginManager.executePlugins(
                'beforeResponse',
                beforeResponsePayload,
                {
                    sessionManager: this.services.sessionManager,
                    mcpManager: this.services.mcpManager,
                    toolManager: this.services.toolManager,
                    stateManager: this.services.stateManager,
                    sessionId: this.id,
                    abortSignal: signal,
                }
            );

            return {
                text: modifiedResponsePayload.content,
            };
        } catch (error) {
            // If this was an intentional cancellation, return partial response from history
            const aborted =
                (error instanceof Error && error.name === 'AbortError') ||
                (typeof error === 'object' && error !== null && (error as any).aborted === true);
            if (aborted) {
                this.eventBus.emit('llm:error', {
                    error: new Error('Run cancelled'),
                    context: 'user_cancelled',
                    recoverable: true,
                });

                // Return partial content that was persisted during streaming
                try {
                    const history = await this.getHistory();
                    const lastAssistant = history.filter((m) => m.role === 'assistant').pop();
                    if (lastAssistant) {
                        if (typeof lastAssistant.content === 'string') {
                            return { text: lastAssistant.content };
                        }
                        // Handle multimodal content (ContentPart[]) - extract text parts
                        if (Array.isArray(lastAssistant.content)) {
                            const text = lastAssistant.content
                                .filter(
                                    (part): part is { type: 'text'; text: string } =>
                                        part.type === 'text'
                                )
                                .map((part) => part.text)
                                .join('');
                            if (text) {
                                return { text };
                            }
                        }
                    }
                } catch {
                    this.logger.debug('Failed to retrieve partial response from history on cancel');
                }
                return { text: '' };
            }

            // Check if this is a plugin blocking error
            if (
                error instanceof DextoRuntimeError &&
                error.code === PluginErrorCode.PLUGIN_BLOCKED_EXECUTION &&
                error.scope === ErrorScope.PLUGIN &&
                error.type === ErrorType.FORBIDDEN
            ) {
                // Save the blocked interaction to history
                const textContent = parts
                    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map((p) => p.text)
                    .join('\n');
                try {
                    await this.saveBlockedInteraction(textContent, error.message);
                    this.logger.debug(
                        `ChatSession ${this.id}: Saved blocked interaction to history`
                    );
                } catch (saveError) {
                    this.logger.warn(
                        `Failed to save blocked interaction to history: ${
                            saveError instanceof Error ? saveError.message : String(saveError)
                        }`
                    );
                }

                return { text: error.message };
            }

            this.logger.error(
                `Error in ChatSession.stream: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        } finally {
            this.currentRunController = null;
        }
    }

    /**
     * Combine multiple abort signals into one.
     */
    private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
        const controller = new AbortController();

        const onAbort = () => controller.abort();

        signal1.addEventListener('abort', onAbort);
        signal2.addEventListener('abort', onAbort);

        if (signal1.aborted || signal2.aborted) {
            controller.abort();
        }

        return controller.signal;
    }

    /**
     * Retrieves the complete conversation history for this session.
     *
     * Returns a read-only copy of all messages in the conversation, including:
     * - User messages
     * - Assistant responses
     * - Tool call results
     * - System messages
     *
     * The history is formatted as internal messages and may include multimodal
     * content (text and images).
     *
     * @returns Promise that resolves to a read-only array of conversation messages in chronological order
     *
     * @example
     * ```typescript
     * const history = await session.getHistory();
     * console.log(`Conversation has ${history.length} messages`);
     * history.forEach(msg => console.log(`${msg.role}: ${msg.content}`));
     * ```
     */
    public async getHistory() {
        return await this.historyProvider.getHistory();
    }

    /**
     * Reset the conversation history for this session.
     *
     * This method:
     * 1. Clears all messages from the session's conversation history
     * 2. Removes persisted history from the storage provider
     * 3. Emits a `session:reset` event with session context
     *
     * The system prompt and session configuration remain unchanged.
     * Only the conversation messages are cleared.
     *
     * @returns Promise that resolves when the reset is complete
     *
     * @example
     * ```typescript
     * await session.reset();
     * console.log('Conversation history cleared');
     * ```
     *
     * @see {@link ContextManager.resetConversation} for the underlying implementation
     */
    public async reset(): Promise<void> {
        await this.llmService.getContextManager().resetConversation();

        // Emit agent-level event with session context
        this.services.agentEventBus.emit('session:reset', {
            sessionId: this.id,
        });
    }

    /**
     * Gets the session's ContextManager instance.
     *
     * @returns The ContextManager for this session
     */
    public getContextManager(): ContextManager<unknown> {
        return this.llmService.getContextManager();
    }

    /**
     * Gets the session's LLMService instance.
     *
     * @returns The LLMService for this session
     */
    public getLLMService(): VercelLLMService {
        return this.llmService;
    }

    /**
     * Switches the LLM service for this session while preserving conversation history.
     *
     * This method creates a new LLM service with the specified configuration,
     * while maintaining the existing ContextManager and conversation history. This allows
     * users to change AI models mid-conversation without losing context.
     *
     * @param newLLMConfig The new LLM configuration to use
     *
     * @example
     * ```typescript
     * // Switch from Claude to GPT-5 while keeping conversation history
     * session.switchLLM({
     *   provider: 'openai',
     *   model: 'gpt-5',
     *   apiKey: process.env.OPENAI_API_KEY,
     * });
     * ```
     */
    public async switchLLM(newLLMConfig: ValidatedLLMConfig): Promise<void> {
        try {
            // Get compression config for this session
            const runtimeConfig = this.services.stateManager.getRuntimeConfig(this.id);

            // Create model and compaction strategy from config
            const model = createVercelModel(newLLMConfig);
            const compactionStrategy = await createCompactionStrategy(runtimeConfig.compaction, {
                logger: this.logger,
                model,
            });

            // Create new LLM service with new config but SAME history provider
            // The service will create its own new ContextManager internally
            const newLLMService = createLLMService(
                newLLMConfig,
                this.services.toolManager,
                this.services.systemPromptManager,
                this.historyProvider, // Pass the SAME history provider - preserves conversation!
                this.eventBus, // Use session event bus
                this.id,
                this.services.resourceManager,
                this.logger,
                compactionStrategy, // Pass compaction strategy
                runtimeConfig.compaction // Pass compaction config for threshold settings
            );

            // Replace the LLM service
            this.llmService = newLLMService;

            this.logger.info(
                `ChatSession ${this.id}: LLM switched to ${newLLMConfig.provider}/${newLLMConfig.model}`
            );

            // Emit session-level event
            this.eventBus.emit('llm:switched', {
                newConfig: newLLMConfig,
                historyRetained: true,
            });
        } catch (error) {
            this.logger.error(
                `Error during ChatSession.switchLLM for session ${this.id}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Cleanup the session and its in-memory resources.
     * This method should be called when the session is being removed from memory.
     * Chat history is preserved in storage and can be restored later.
     */
    public async cleanup(): Promise<void> {
        try {
            // Only dispose of event listeners and in-memory resources
            // Do NOT reset conversation - that would delete chat history!
            this.dispose();

            this.logger.debug(
                `ChatSession ${this.id}: Memory cleanup completed (chat history preserved)`
            );

            // Note: We do NOT call this.logger.destroy() here because the session logger
            // is created via createChild() which shares transports with the parent logger.
            // Destroying the child would close shared transports and break logging for
            // other sessions. The child logger will be garbage collected when the
            // session object is discarded.
        } catch (error) {
            this.logger.error(
                `Error during ChatSession cleanup for session ${this.id}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Cleans up listeners and other resources to prevent memory leaks.
     *
     * This method should be called when the session is being discarded to ensure
     * that event listeners are properly removed from the global event bus.
     * Without this cleanup, sessions would remain in memory due to listener references.
     */
    public dispose(): void {
        this.logger.debug(`Disposing session ${this.id} - cleaning up event listeners`);

        // Remove all event forwarders from the session event bus
        this.forwarders.forEach((forwarder, eventName) => {
            this.eventBus.off(eventName, forwarder);
        });

        // Clear the forwarders map
        this.forwarders.clear();

        // Remove token accumulator listener
        if (this.tokenAccumulatorListener) {
            this.eventBus.off('llm:response', this.tokenAccumulatorListener);
            this.tokenAccumulatorListener = null;
        }

        this.logger.debug(`Session ${this.id} disposed successfully`);
    }

    /**
     * Check if this session is currently processing a message.
     * Returns true if a run is in progress and has not been aborted.
     */
    public isBusy(): boolean {
        return this.currentRunController !== null && !this.currentRunController.signal.aborted;
    }

    /**
     * Queue a message for processing when the session is busy.
     * The message will be injected into the conversation when the current turn completes.
     *
     * @param message The user message to queue
     * @returns Queue position and message ID
     */
    public queueMessage(message: UserMessageInput): { queued: true; position: number; id: string } {
        return this.llmService.getMessageQueue().enqueue(message);
    }

    /**
     * Get all messages currently in the queue.
     * @returns Array of queued messages
     */
    public getQueuedMessages(): import('./types.js').QueuedMessage[] {
        return this.llmService.getMessageQueue().getAll();
    }

    /**
     * Remove a queued message.
     * @param id Message ID to remove
     * @returns true if message was found and removed; false otherwise
     */
    public removeQueuedMessage(id: string): boolean {
        return this.llmService.getMessageQueue().remove(id);
    }

    /**
     * Clear all queued messages.
     * @returns Number of messages that were cleared
     */
    public clearMessageQueue(): number {
        const queue = this.llmService.getMessageQueue();
        const count = queue.pendingCount();
        queue.clear();
        return count;
    }

    /**
     * Cancel the currently running turn for this session, if any.
     * Returns true if a run was in progress and was signaled to abort.
     */
    public cancel(): boolean {
        const controller = this.currentRunController;
        if (!controller || controller.signal.aborted) {
            return false;
        }
        try {
            controller.abort();
            return true;
        } catch {
            // Already aborted or abort failed
            return false;
        }
    }
}
