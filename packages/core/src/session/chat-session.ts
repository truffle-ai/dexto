import { createDatabaseHistoryProvider } from './history/factory.js';
import { createLLMService } from '../llm/services/factory.js';
import type { ContextManager } from '@core/context/index.js';
import type { IConversationHistoryProvider } from './history/types.js';
import type { ILLMService } from '../llm/services/types.js';
import type { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ValidatedLLMConfig } from '@core/llm/schemas.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { StorageBackends } from '../storage/backend/types.js';
import {
    SessionEventBus,
    AgentEventBus,
    SessionEventNames,
    SessionEventName,
} from '../events/index.js';
import { logger } from '../logger/index.js';

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
 * - `llmservice:*` events (thinking, toolCall, response, etc.)
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
 * session.eventBus.on('llmservice:response', (payload) => {
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
 * @see {@link ILLMService} for AI model interaction interface
 */
export class ChatSession {
    /**
     * Session-scoped event emitter for handling conversation events.
     *
     * This is a session-local SessionEventBus instance that forwards events
     * to the global agent event bus.
     *
     * Events emitted include:
     * - `llmservice:thinking` - AI model is processing
     * - `llmservice:toolCall` - Tool execution requested
     * - `llmservice:response` - Final response generated
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
    private llmService!: ILLMService;

    /**
     * Map of event forwarder functions for cleanup.
     * Stores the bound functions so they can be removed from the event bus.
     */
    private forwarders: Map<SessionEventName, (payload?: any) => void> = new Map();

    /**
     * AbortController for the currently running turn, if any.
     * Calling cancel() aborts the in-flight LLM request and tool execution checks.
     */
    private currentRunController: AbortController | null = null;

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
     */
    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            agentEventBus: AgentEventBus;
            storage: StorageBackends;
            resourceManager: import('../resources/index.js').ResourceManager;
        },
        public readonly id: string
    ) {
        // Create session-specific event bus
        this.eventBus = new SessionEventBus();

        // Set up event forwarding to agent's global bus
        this.setupEventForwarding();

        // Services will be initialized in init() method due to async requirements
        logger.debug(`ChatSession ${this.id}: Created, awaiting initialization`);
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
                logger.silly(
                    `Forwarding session event ${eventName} to agent bus with session context: ${JSON.stringify(payloadWithSession, null, 2)}`
                );
                // Forward to agent bus with session context
                this.services.agentEventBus.emit(eventName as any, payloadWithSession);
            };

            // Store the forwarder function for later cleanup
            this.forwarders.set(eventName, forwarder);

            // Attach the forwarder to the session event bus
            this.eventBus.on(eventName, forwarder);
        });
    }

    /**
     * Initializes session-specific services.
     */
    private async initializeServices(): Promise<void> {
        // Get current effective configuration for this session from state manager
        const llmConfig = this.services.stateManager.getLLMConfig(this.id);

        // Create session-specific history provider directly with database backend
        // This persists across LLM switches to maintain conversation history
        this.historyProvider = createDatabaseHistoryProvider(
            this.services.storage.database,
            this.id
        );

        // Create session-specific LLM service
        // The service will create its own properly-typed ContextManager internally
        this.llmService = createLLMService(
            llmConfig,
            llmConfig.router,
            this.services.toolManager,
            this.services.systemPromptManager,
            this.historyProvider, // Pass history provider for service to use
            this.eventBus, // Use session event bus
            this.id,
            this.services.resourceManager // Pass ResourceManager for blob storage
        );

        logger.debug(`ChatSession ${this.id}: Services initialized with storage`);
    }

    /**
     * Processes user input through the session's LLM service and returns the response.
     *
     * This method:
     * 1. Takes user input (text, optionally with image or file data)
     * 2. Passes it to the LLM service for processing
     * 3. Returns the AI's response text
     *
     * The method handles both text-only and multimodal input (text + images/files).
     * Tool calls and conversation management are handled internally by the LLM service.
     *
     * @param input - The user's text input
     * @param imageDataInput - Optional image data for multimodal input
     * @param fileDataInput - Optional file data for file input
     * @param stream - Optional flag to enable streaming responses
     * @returns Promise that resolves to the AI's response text
     *
     * @example
     * ```typescript
     * const response = await session.run('What is the weather like today?');
     * console.log(response); // "I'll check the weather for you..."
     * ```
     */
    public async run(
        input: string,
        imageDataInput?: { image: string; mimeType: string },
        fileDataInput?: { data: string; mimeType: string; filename?: string },
        stream?: boolean
    ): Promise<string> {
        logger.debug(
            `Running session ${this.id} with input: ${input}, imageDataInput: ${imageDataInput}, fileDataInput: ${fileDataInput}`
        );

        // Input validation is now handled at DextoAgent.run() level
        // Create an AbortController for this run and expose for cancellation
        this.currentRunController = new AbortController();
        const signal = this.currentRunController.signal;
        try {
            const response = await this.llmService.completeTask(
                input,
                { signal },
                imageDataInput,
                fileDataInput,
                stream
            );
            return response;
        } catch (error) {
            // If this was an intentional cancellation, emit a recoverable error event and return empty string
            const aborted =
                (error instanceof Error && error.name === 'AbortError') ||
                (typeof error === 'object' && error !== null && (error as any).aborted === true);
            if (aborted) {
                // TODO: Remove emit errors, cancellation is a normal state and not an error state.
                // LLMService.completeTask should return the partial computed response till then
                // and not error out in case the execution was cancelled.
                this.eventBus.emit('llmservice:error', {
                    error: new Error('Run cancelled'),
                    context: 'user_cancelled',
                    recoverable: true,
                });
                return '';
            }
            // TODO: Currently this only applies for OpenAI, Anthropic services, because Vercel works differently.
            // We should remove this error handling when we handle partial responses properly in all services.
            throw error;
        } finally {
            // Clear controller after run completes or is cancelled
            this.currentRunController = null;
        }
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
     * 3. Emits a `dexto:conversationReset` event with session context
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
        // Reset history via history provider
        await this.historyProvider.clearHistory();

        // Emit agent-level event with session context
        this.services.agentEventBus.emit('dexto:conversationReset', {
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
    public getLLMService(): ILLMService {
        return this.llmService;
    }

    /**
     * Switches the LLM service for this session while preserving conversation history.
     *
     * This method creates a new LLM service with the specified configuration and router,
     * while maintaining the existing ContextManager and conversation history. This allows
     * users to change AI models mid-conversation without losing context.
     *
     * @param newLLMConfig The new LLM configuration to use (includes router)
     *
     * @example
     * ```typescript
     * // Switch from Claude to GPT-4 while keeping conversation history
     * session.switchLLM({
     *   provider: 'openai',
     *   model: 'gpt-4',
     *   apiKey: process.env.OPENAI_API_KEY,
     *   router: 'in-built'
     * });
     * ```
     */
    public async switchLLM(newLLMConfig: ValidatedLLMConfig): Promise<void> {
        try {
            // Create new LLM service with new config but SAME history provider
            // The service will create its own new ContextManager internally
            const router = newLLMConfig.router;
            const newLLMService = createLLMService(
                newLLMConfig,
                router,
                this.services.toolManager,
                this.services.systemPromptManager,
                this.historyProvider, // Pass the SAME history provider - preserves conversation!
                this.eventBus, // Use session event bus
                this.id
            );

            // Replace the LLM service
            this.llmService = newLLMService;

            logger.info(
                `ChatSession ${this.id}: LLM switched to ${newLLMConfig.provider}/${newLLMConfig.model}`
            );

            // Emit session-level event
            this.eventBus.emit('llmservice:switched', {
                newConfig: newLLMConfig,
                router,
                historyRetained: true,
            });
        } catch (error) {
            logger.error(
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

            logger.debug(
                `ChatSession ${this.id}: Memory cleanup completed (chat history preserved)`
            );
        } catch (error) {
            logger.error(
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
        logger.debug(`Disposing session ${this.id} - cleaning up event listeners`);

        // Remove all event forwarders from the session event bus
        this.forwarders.forEach((forwarder, eventName) => {
            this.eventBus.off(eventName, forwarder);
        });

        // Clear the forwarders map
        this.forwarders.clear();

        logger.debug(`Session ${this.id} disposed successfully`);
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
