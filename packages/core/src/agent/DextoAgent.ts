// src/agent/DextoAgent.ts
import { randomUUID } from 'crypto';
import { setMaxListeners } from 'events';
import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { SkillsContributor } from '../systemPrompt/contributors.js';
import { ResourceManager, expandMessageReferences } from '../resources/index.js';
import { expandBlobReferences } from '../context/utils.js';
import { StorageManager } from '../storage/index.js';
import type { InternalMessage } from '../context/types.js';
import { PromptManager } from '../prompts/index.js';
import type { PromptsConfig } from '../prompts/schemas.js';
import { AgentStateManager } from './state-manager.js';
import { SessionManager, ChatSession, SessionError } from '../session/index.js';
import type { SessionMetadata } from '../session/index.js';
import { AgentServices, type InitializeServicesOptions } from '../utils/service-initializer.js';
import type { Logger } from '../logger/v2/types.js';
import { Telemetry } from '../telemetry/telemetry.js';
import { InstrumentClass } from '../telemetry/decorators.js';
import { trace, context, propagation, type BaggageEntry } from '@opentelemetry/api';
import { resolveAndValidateLLMConfig } from '../llm/resolver.js';
import { validateInputForLLM } from '../llm/validation.js';
import { LLMError } from '../llm/errors.js';
import { AgentError } from './errors.js';
import { MCPError } from '../mcp/errors.js';
import { MCPErrorCode } from '../mcp/error-codes.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { DextoValidationError } from '../errors/DextoValidationError.js';
import { ensureOk } from '../errors/result-bridge.js';
import { fail, zodToIssues } from '../utils/result.js';
import { resolveAndValidateMcpServerConfig } from '../mcp/resolver.js';
import type { McpServerConfig, McpServerStatus, McpConnectionStatus } from '../mcp/schemas.js';
import {
    getSupportedProviders,
    getDefaultModelForProvider,
    getProviderFromModel,
    getAllModelsForProvider,
} from '../llm/registry/index.js';
import type { ModelInfo } from '../llm/registry/index.js';
import type { LLMProvider } from '../llm/types.js';
import { createAgentServices } from '../utils/service-initializer.js';
import { LLMConfigSchema, LLMUpdatesSchema } from '../llm/schemas.js';
import type { LLMUpdates, ValidatedLLMConfig } from '../llm/schemas.js';
import { ServersConfigSchema } from '../mcp/schemas.js';
import { MemoriesConfigSchema } from '../memory/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { InternalResourcesSchema } from '../resources/schemas.js';
import { SessionConfigSchema } from '../session/schemas.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { ElicitationConfigSchema, ToolConfirmationConfigSchema } from '../tools/schemas.js';
import { OtelConfigurationSchema } from '../telemetry/schemas.js';
import { AgentCardSchema } from './schemas.js';
import type { AgentRuntimeSettings, DextoAgentConfigInput } from './runtime-config.js';
import {
    AgentEventBus,
    type AgentEventMap,
    type StreamingEvent,
    type StreamingEventName,
} from '../events/index.js';
import type { McpClient } from '../mcp/types.js';
import type { Tool, ToolSet } from '../tools/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { SearchService } from '../search/index.js';
import type { SearchOptions, SearchResponse, SessionSearchResponse } from '../search/index.js';
import { safeStringify } from '../utils/safe-stringify.js';
import { deriveHeuristicTitle, generateSessionTitle } from '../session/title-generator.js';
import type { ApprovalHandler } from '../approval/types.js';
import type { DextoAgentOptions } from './agent-options.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SetWorkspaceInput, WorkspaceContext } from '../workspace/types.js';

const requiredServices: (keyof AgentServices)[] = [
    'mcpManager',
    'toolManager',
    'systemPromptManager',
    'agentEventBus',
    'stateManager',
    'sessionManager',
    'workspaceManager',
    'searchService',
    'memoryManager',
];

/**
 * Interface for objects that can subscribe to the agent's event bus.
 * Typically used by API layer subscribers (SSE, Webhooks, etc.)
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
 * // (Host layers parse/validate config and resolve DI services before constructing the agent.)
 * const agent = new DextoAgent({
 *   ...runtimeSettings, // validated AgentRuntimeSettings
 *   logger,
 *   storage,
 *   tools,
 *   plugins,
 * });
 * await agent.start();
 *
 * // Process user messages
 * const response = await agent.run("Hello, how are you?");
 *
 * // Switch LLM models (provider inferred automatically)
 * await agent.switchLLM({ model: 'gpt-5' });
 *
 * // Manage sessions
 * const session = await agent.createSession('user-123');
 * const response = await agent.run("Hello", undefined, undefined, session.id);
 *
 * // Connect MCP servers
 * await agent.addMcpServer('filesystem', { command: 'mcp-filesystem' });
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
        'on',
        'once',
        'off',
        'emit',
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
    private readonly agentEventBus: AgentEventBus;
    public readonly promptManager!: PromptManager;
    public readonly stateManager!: AgentStateManager;
    public readonly sessionManager!: SessionManager;
    public readonly workspaceManager!: WorkspaceManager;
    public readonly toolManager!: ToolManager;
    public readonly resourceManager!: ResourceManager;
    public readonly memoryManager!: import('../memory/index.js').MemoryManager;
    public readonly services!: AgentServices;

    // Search service for conversation search
    private searchService!: SearchService;

    // Track initialization state
    private _isStarted: boolean = false;
    private _isStopped: boolean = false;

    // Store config for async initialization (accessible before start() for setup)
    public config: AgentRuntimeSettings;

    // Event subscribers (e.g., SSE, Webhook handlers)
    private eventSubscribers: Set<AgentEventSubscriber> = new Set();

    // Telemetry instance for distributed tracing
    private telemetry?: Telemetry;

    // Approval handler for manual tool confirmation and elicitation
    // Set via setApprovalHandler() before start() if needed
    private approvalHandler?: ApprovalHandler | undefined;
    private mcpAuthProviderFactory: import('../mcp/types.js').McpAuthProviderFactory | null = null;

    // Active stream controllers per session - allows cancel() to abort iterators
    private activeStreamControllers: Map<string, AbortController> = new Map();

    // Host overrides for service initialization (e.g. session logger factory)
    private readonly serviceOverrides: InitializeServicesOptions;

    // DI-provided local tools.
    private readonly injectedTools: Tool[];
    private readonly injectedCompactionStrategy: CompactionStrategy | null;

    // Logger instance for this agent (dependency injection)
    public readonly logger: Logger;

    /**
     * Validate + normalize runtime settings.
     *
     * This is the single validation boundary for programmatic (code-first) construction.
     * Host layers may validate earlier (e.g. YAML parsing), but core always normalizes
     * runtime settings before use.
     */
    public static validateConfig(options: DextoAgentConfigInput): AgentRuntimeSettings {
        return {
            agentId: options.agentId,
            llm: LLMConfigSchema.parse(options.llm),
            systemPrompt: SystemPromptConfigSchema.parse(options.systemPrompt),
            mcpServers: ServersConfigSchema.parse(options.mcpServers ?? {}),
            sessions: SessionConfigSchema.parse(options.sessions ?? {}),
            toolConfirmation: ToolConfirmationConfigSchema.parse(options.toolConfirmation ?? {}),
            elicitation: ElicitationConfigSchema.parse(options.elicitation ?? {}),
            internalResources: InternalResourcesSchema.parse(options.internalResources),
            prompts: PromptsSchema.parse(options.prompts),
            ...(options.agentCard !== undefined && {
                agentCard: AgentCardSchema.parse(options.agentCard),
            }),
            ...(options.greeting !== undefined && { greeting: options.greeting }),
            ...(options.telemetry !== undefined && {
                telemetry: OtelConfigurationSchema.parse(options.telemetry),
            }),
            ...(options.memories !== undefined && {
                memories: MemoriesConfigSchema.parse(options.memories),
            }),
        };
    }

    /**
     * Creates a DextoAgent instance.
     *
     * Constructor options are DI-first:
     * - runtime settings (validated + defaulted by core)
     * - concrete services (logger/tools/plugins/storage backends)
     * - optional internal service overrides (session logging, auth factories, etc.)
     */
    constructor(options: DextoAgentOptions) {
        const {
            logger,
            storage,
            tools: toolsInput,
            plugins: pluginsInput,
            compaction,
            overrides: overridesInput,
            ...runtimeSettings
        } = options;

        const tools = toolsInput ?? [];
        const plugins = pluginsInput ?? [];

        this.config = DextoAgent.validateConfig(runtimeSettings);

        // Agent logger is always provided by the host (typically created from config).
        this.logger = logger;

        this.injectedTools = tools;
        this.injectedCompactionStrategy = compaction ?? null;

        const overrides: InitializeServicesOptions = { ...(overridesInput ?? {}) };

        if (overrides.storageManager === undefined) {
            overrides.storageManager = new StorageManager(
                {
                    cache: storage.cache,
                    database: storage.database,
                    blobStore: storage.blob,
                },
                this.logger
            );
        }

        if (overrides.plugins === undefined) {
            overrides.plugins = plugins;
        }

        this.serviceOverrides = overrides;

        if (overrides.mcpAuthProviderFactory !== undefined) {
            this.mcpAuthProviderFactory = overrides.mcpAuthProviderFactory;
        }

        // Create event bus early so it's available for approval handler creation
        this.agentEventBus = new AgentEventBus();

        // call start() to initialize services
        this.logger.info('DextoAgent created.');
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
            this.logger.info('Starting DextoAgent...');

            // Initialize all services asynchronously
            // Pass logger and eventBus to services for dependency injection
            const services = await createAgentServices(
                this.config,
                this.logger,
                this.agentEventBus,
                this.serviceOverrides,
                this.injectedCompactionStrategy
            );

            if (this.mcpAuthProviderFactory) {
                services.mcpManager.setAuthProviderFactory(this.mcpAuthProviderFactory);
            }

            // Validate all required services are provided
            for (const service of requiredServices) {
                if (!services[service]) {
                    throw AgentError.initializationFailed(
                        `Required service ${service} is missing during agent start`
                    );
                }
            }

            // Validate approval configuration
            // Handler is required for manual tool confirmation OR when elicitation is enabled
            const needsHandler =
                this.config.toolConfirmation.mode === 'manual' || this.config.elicitation.enabled;

            if (needsHandler && !this.approvalHandler) {
                const reasons = [];
                if (this.config.toolConfirmation.mode === 'manual') {
                    reasons.push('tool confirmation mode is "manual"');
                }
                if (this.config.elicitation.enabled) {
                    reasons.push('elicitation is enabled');
                }

                throw AgentError.initializationFailed(
                    `An approval handler is required but not configured (${reasons.join(' and ')}).\n` +
                        'Either:\n' +
                        '  • Call agent.setApprovalHandler() before starting\n' +
                        '  • Set toolConfirmation: { mode: "auto-approve" } or { mode: "auto-deny" }\n' +
                        '  • Disable elicitation: { enabled: false }'
                );
            }

            // Set approval handler if provided via setApprovalHandler() before start()
            if (this.approvalHandler) {
                services.approvalManager.setHandler(this.approvalHandler);
            }

            // Use Object.assign to set readonly properties
            Object.assign(this, {
                mcpManager: services.mcpManager,
                toolManager: services.toolManager,
                resourceManager: services.resourceManager,
                systemPromptManager: services.systemPromptManager,
                stateManager: services.stateManager,
                sessionManager: services.sessionManager,
                workspaceManager: services.workspaceManager,
                memoryManager: services.memoryManager,
                services: services,
            });

            // Initialize prompts manager (aggregates MCP, internal, starter prompts)
            // File prompts automatically resolve custom slash commands
            // Must be initialized before toolManager so invoke_skill tool can access prompts
            const promptManager = new PromptManager(
                this.mcpManager,
                this.resourceManager,
                this.config,
                this.agentEventBus,
                services.storageManager.getDatabase(),
                this.logger
            );
            await promptManager.initialize();
            Object.assign(this, { promptManager });

            // Provide ToolExecutionContext to tools at runtime (late-binding to avoid init ordering cycles)
            const toolExecutionStorage = {
                blob: services.storageManager.getBlobStore(),
                database: services.storageManager.getDatabase(),
                cache: services.storageManager.getCache(),
            };
            const toolExecutionServices = {
                approval: services.approvalManager,
                search: services.searchService,
                resources: services.resourceManager,
                prompts: promptManager,
                mcp: services.mcpManager,
                taskForker: null,
            };
            services.toolManager.setToolExecutionContextFactory((baseContext) => ({
                ...baseContext,
                agent: this,
                storage: toolExecutionStorage,
                services: toolExecutionServices,
            }));

            const localTools = this.injectedTools;

            // Add skills contributor to system prompt if invoke_skill is enabled.
            // This lists available skills so the LLM knows what it can invoke.
            if (localTools.some((t) => t.id === 'internal--invoke_skill')) {
                const skillsContributor = new SkillsContributor(
                    'skills',
                    50, // Priority after memories (40) but before most other content
                    promptManager,
                    this.logger
                );
                services.systemPromptManager.addContributor(skillsContributor);
                this.logger.debug('Added SkillsContributor to system prompt');
            }

            services.toolManager.setTools(localTools);

            // Initialize toolManager after tools and context have been wired.
            await services.toolManager.initialize();

            // Initialize search service from services
            this.searchService = services.searchService;

            // Note: Telemetry is initialized in createAgentServices() before services are created
            // This ensures decorators work correctly on all services

            this._isStarted = true;
            this._isStopped = false; // Reset stopped flag to allow restart
            this.logger.info('DextoAgent started successfully.');

            // Subscribe all registered event subscribers to the new event bus
            for (const subscriber of this.eventSubscribers) {
                subscriber.subscribe(this.agentEventBus);
            }
        } catch (error) {
            this.logger.error('Failed to start DextoAgent', {
                error: error instanceof Error ? error.message : String(error),
            });
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
            this.logger.warn('Agent is already stopped');
            return;
        }

        if (!this._isStarted) {
            throw AgentError.notStarted();
        }

        try {
            this.logger.info('Stopping DextoAgent...');

            const shutdownErrors: Error[] = [];

            // 1. Clean up session manager (stop accepting new sessions, clean existing ones)
            try {
                if (this.sessionManager) {
                    await this.sessionManager.cleanup();
                    this.logger.debug('SessionManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`SessionManager cleanup failed: ${err.message}`));
            }

            // 1.5 Clean up tool-managed resources (custom tool providers, subagents, etc.)
            try {
                if (this.toolManager) {
                    await this.toolManager.cleanup();
                    this.logger.debug('ToolManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`ToolManager cleanup failed: ${err.message}`));
            }

            // 2. Clean up plugins (close file handles, connections, etc.)
            // Do this before storage disconnect so plugins can flush state if needed
            try {
                if (this.services?.pluginManager) {
                    await this.services.pluginManager.cleanup();
                    this.logger.debug('PluginManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`PluginManager cleanup failed: ${err.message}`));
            }

            // 3. Disconnect all MCP clients
            try {
                if (this.mcpManager) {
                    await this.mcpManager.disconnectAll();
                    this.logger.debug('MCPManager disconnected all clients successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`MCPManager disconnect failed: ${err.message}`));
            }

            // 3.5 Clean up resource manager listeners
            try {
                if (this.resourceManager) {
                    this.resourceManager.cleanup();
                    this.logger.debug('ResourceManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`ResourceManager cleanup failed: ${err.message}`));
            }

            // 4. Close storage backends
            try {
                if (this.services?.storageManager) {
                    await this.services.storageManager.disconnect();
                    this.logger.debug('Storage manager disconnected successfully');
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
                this.logger.warn(`DextoAgent stopped with some errors: ${errorMessages}`);
                // Still consider it stopped, but log the errors
            } else {
                this.logger.info('DextoAgent stopped successfully.');
            }

            this.agentEventBus.emit('agent:stopped');
        } catch (error) {
            this.logger.error('Failed to stop DextoAgent', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Register an event subscriber that will be automatically re-subscribed on agent restart.
     * Subscribers are typically API layer components (SSE, Webhook handlers) that need
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
     * Convenience event subscription APIs (typed delegates to {@link AgentEventBus}).
     *
     * Prefer these over reaching into the internal event bus directly.
     */
    public on<K extends keyof AgentEventMap>(
        event: K,
        listener: AgentEventMap[K] extends void ? () => void : (payload: AgentEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this {
        this.agentEventBus.on(event, listener, options);
        return this;
    }

    public once<K extends keyof AgentEventMap>(
        event: K,
        listener: AgentEventMap[K] extends void ? () => void : (payload: AgentEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this {
        this.agentEventBus.once(event, listener, options);
        return this;
    }

    public off<K extends keyof AgentEventMap>(
        event: K,
        listener: AgentEventMap[K] extends void ? () => void : (payload: AgentEventMap[K]) => void
    ): this {
        this.agentEventBus.off(event, listener);
        return this;
    }

    public emit<K extends keyof AgentEventMap>(
        event: K,
        ...args: AgentEventMap[K] extends void ? [] : [AgentEventMap[K]]
    ): boolean {
        return this.agentEventBus.emit(event, ...args);
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
            this.logger.warn('Agent is stopped');
            throw AgentError.stopped();
        }
        if (!this._isStarted) {
            this.logger.warn('Agent is not started');
            throw AgentError.notStarted();
        }
    }

    // ============= CORE AGENT FUNCTIONALITY =============

    /**
     * Process user input and return the response.
     *
     * @deprecated Use generate() or stream() instead for multi-image support.
     * This method is kept for backward compatibility and only supports single image/file.
     *
     * @param textInput - The user's text message
     * @param imageDataInput - Optional single image data
     * @param fileDataInput - Optional single file data
     * @param sessionId - Session ID for the conversation (required)
     * @param _stream - Ignored (streaming is handled internally)
     * @returns Promise that resolves to the AI's response text
     */
    public async run(
        textInput: string,
        imageDataInput: { image: string; mimeType: string } | undefined,
        fileDataInput: { data: string; mimeType: string; filename?: string } | undefined,
        sessionId: string,
        _stream: boolean = false
    ): Promise<string> {
        // Convert legacy signature to ContentPart[]
        const parts: import('./types.js').ContentPart[] = [];

        if (textInput) {
            parts.push({ type: 'text', text: textInput });
        }

        if (imageDataInput) {
            parts.push({
                type: 'image',
                image: imageDataInput.image,
                mimeType: imageDataInput.mimeType,
            });
        }

        if (fileDataInput) {
            parts.push({
                type: 'file',
                data: fileDataInput.data,
                mimeType: fileDataInput.mimeType,
                ...(fileDataInput.filename && { filename: fileDataInput.filename }),
            });
        }

        // Call generate() which handles everything
        const response = await this.generate(parts.length > 0 ? parts : textInput, sessionId);
        return response.content;
    }

    /**
     * Generate a complete response (waits for full completion).
     * This is the recommended method for non-streaming use cases.
     *
     * @param content String message or array of content parts (text, images, files)
     * @param sessionId Session ID for the conversation
     * @param options Optional configuration (signal for cancellation)
     * @returns Promise that resolves to the complete response
     *
     * @example
     * ```typescript
     * // Simple text message
     * const response = await agent.generate('What is 2+2?', 'session-1');
     * console.log(response.content); // "4"
     *
     * // Multimodal with image
     * const response = await agent.generate(
     *     [
     *         { type: 'text', text: 'Describe this image' },
     *         { type: 'image', image: base64Data, mimeType: 'image/png' }
     *     ],
     *     'session-1'
     * );
     * ```
     */
    public async generate(
        content: import('./types.js').ContentInput,
        sessionId: string,
        options?: import('./types.js').GenerateOptions
    ): Promise<import('./types.js').GenerateResponse> {
        // Collect all events from stream
        const events: StreamingEvent[] = [];

        for await (const event of await this.stream(content, sessionId, options)) {
            events.push(event);
        }

        // Check for non-recoverable error events - only throw on fatal errors
        // Recoverable errors (like tool failures) are included in the response for the caller to handle
        const fatalErrorEvent = events.find(
            (e): e is Extract<StreamingEvent, { name: 'llm:error' }> =>
                e.name === 'llm:error' && e.recoverable !== true
        );
        if (fatalErrorEvent) {
            // If it's already a Dexto error (Runtime or Validation), throw it directly
            if (
                fatalErrorEvent.error instanceof DextoRuntimeError ||
                fatalErrorEvent.error instanceof DextoValidationError
            ) {
                throw fatalErrorEvent.error;
            }
            // Otherwise wrap plain Error in DextoRuntimeError for proper HTTP status handling
            const llmConfig = this.stateManager.getLLMConfig(sessionId);
            throw LLMError.generationFailed(
                fatalErrorEvent.error.message,
                llmConfig.provider,
                llmConfig.model
            );
        }

        // Find the last llm:response event (final response after all tool calls)
        const responseEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:response' }> => e.name === 'llm:response'
        );
        const responseEvent = responseEvents[responseEvents.length - 1];
        if (!responseEvent || responseEvent.name !== 'llm:response') {
            // Get current LLM config for error context
            const llmConfig = this.stateManager.getLLMConfig(sessionId);
            throw LLMError.generationFailed(
                'Stream did not complete successfully - no response received',
                llmConfig.provider,
                llmConfig.model
            );
        }

        // Collect tool calls from llm:tool-call events
        const toolCallEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:tool-call' }> =>
                e.name === 'llm:tool-call'
        );
        const toolResultEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:tool-result' }> =>
                e.name === 'llm:tool-result'
        );

        const toolCalls: import('./types.js').AgentToolCall[] = toolCallEvents.map((tc) => {
            const toolResult = toolResultEvents.find((tr) => tr.callId === tc.callId);
            return {
                toolName: tc.toolName,
                args: tc.args,
                callId: tc.callId || `tool_${Date.now()}`,
                result: toolResult
                    ? {
                          success: toolResult.success,
                          data: toolResult.sanitized,
                      }
                    : undefined,
            };
        });

        // Ensure usage matches LLMTokenUsage type with all required fields
        const defaultUsage: import('./types.js').TokenUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        };
        const usage = responseEvent.tokenUsage ?? defaultUsage;

        return {
            content: responseEvent.content,
            reasoning: responseEvent.reasoning,
            usage: usage as import('./types.js').TokenUsage,
            toolCalls,
            sessionId,
        };
    }

    /**
     * Stream a response (yields events as they arrive).
     * This is the recommended method for real-time streaming UI updates.
     *
     * TODO: Refactor to move AsyncIterator down to LLM service level (Option 1).
     * Streaming message API that returns core AgentEvents in real-time.
     * Only emits STREAMING_EVENTS (tier 1 visibility) - events designed for real-time chat UIs.
     *
     * Events are forwarded directly from the AgentEventBus with no mapping layer,
     * providing a unified event system across all API layers.
     *
     * @param content String message or array of content parts (text, images, files)
     * @param sessionId Session ID for the conversation
     * @param options Optional configuration (signal for cancellation)
     * @returns AsyncIterator that yields StreamingEvent objects (core events with name property)
     *
     * @example
     * ```typescript
     * // Simple text
     * for await (const event of await agent.stream('Write a poem', 'session-1')) {
     *   if (event.name === 'llm:chunk') process.stdout.write(event.content);
     * }
     *
     * // Multimodal
     * for await (const event of await agent.stream(
     *     [{ type: 'text', text: 'Describe this' }, { type: 'image', image: data, mimeType: 'image/png' }],
     *     'session-1'
     * )) { ... }
     * ```
     */
    public async stream(
        content: import('./types.js').ContentInput,
        sessionId: string,
        options?: import('./types.js').StreamOptions
    ): Promise<AsyncIterableIterator<StreamingEvent>> {
        this.ensureStarted();

        // Validate sessionId is provided
        if (!sessionId) {
            throw AgentError.apiValidationError('sessionId is required');
        }

        const signal = options?.signal;

        // Normalize content: string -> [{ type: 'text', text: string }]
        let contentParts: import('./types.js').ContentPart[] =
            typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];

        // Event queue for aggregation - now holds core events directly
        const eventQueue: StreamingEvent[] = [];
        let completed = false;

        // Create AbortController for cleanup
        const controller = new AbortController();
        const cleanupSignal = controller.signal;

        // Store controller so cancel() can abort this stream
        this.activeStreamControllers.set(sessionId, controller);

        // Increase listener limit - stream() registers 12+ event listeners on this signal
        setMaxListeners(30, cleanupSignal);

        // Track listener references for manual cleanup
        // Using Function type here because listeners have different signatures per event
        const listeners: Array<{
            event: StreamingEventName;
            listener: Function;
        }> = [];

        // Cleanup function to remove all listeners and stream controller
        const cleanupListeners = () => {
            if (listeners.length === 0) {
                return; // Already cleaned up
            }
            for (const { event, listener } of listeners) {
                this.agentEventBus.off(
                    event,
                    listener as Parameters<typeof this.agentEventBus.off>[1]
                );
            }
            listeners.length = 0;
            // Remove from active controllers map
            this.activeStreamControllers.delete(sessionId);
        };

        // Wire external signal to trigger cleanup
        if (signal) {
            const abortHandler = () => {
                cleanupListeners();
                controller.abort();
            };
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        // TODO: Simplify these explicit subscriptions while keeping full type safety.
        // The verbose approach avoids `any` and casts that were in the original loop.
        // Potential approaches: function overloads on EventBus, or mapped type helpers.
        // Subscribe to each streaming event with concrete types (spread works without cast)
        const thinkingListener = (data: AgentEventMap['llm:thinking']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:thinking', ...data });
        };
        this.agentEventBus.on('llm:thinking', thinkingListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:thinking', listener: thinkingListener });

        const chunkListener = (data: AgentEventMap['llm:chunk']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:chunk', ...data });
        };
        this.agentEventBus.on('llm:chunk', chunkListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:chunk', listener: chunkListener });

        const responseListener = (data: AgentEventMap['llm:response']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:response', ...data });
            // NOTE: We no longer set completed=true here.
            // The iterator closes when run:complete is received, not llm:response.
            // This allows queued messages to be processed after an LLM response.
        };
        this.agentEventBus.on('llm:response', responseListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:response', listener: responseListener });

        const toolCallListener = (data: AgentEventMap['llm:tool-call']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-call', ...data });
        };
        this.agentEventBus.on('llm:tool-call', toolCallListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:tool-call', listener: toolCallListener });

        const toolCallPartialListener = (data: AgentEventMap['llm:tool-call-partial']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-call-partial', ...data });
        };
        this.agentEventBus.on('llm:tool-call-partial', toolCallPartialListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'llm:tool-call-partial', listener: toolCallPartialListener });

        const toolResultListener = (data: AgentEventMap['llm:tool-result']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-result', ...data });
        };
        this.agentEventBus.on('llm:tool-result', toolResultListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:tool-result', listener: toolResultListener });

        const errorListener = (data: AgentEventMap['llm:error']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:error', ...data });
            if (!data.recoverable) {
                completed = true;
            }
        };
        this.agentEventBus.on('llm:error', errorListener, { signal: cleanupSignal });
        listeners.push({ event: 'llm:error', listener: errorListener });

        const unsupportedInputListener = (data: AgentEventMap['llm:unsupported-input']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:unsupported-input', ...data });
        };
        this.agentEventBus.on('llm:unsupported-input', unsupportedInputListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'llm:unsupported-input', listener: unsupportedInputListener });

        const titleUpdatedListener = (data: AgentEventMap['session:title-updated']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'session:title-updated', ...data });
        };
        this.agentEventBus.on('session:title-updated', titleUpdatedListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'session:title-updated', listener: titleUpdatedListener });

        const approvalRequestListener = (data: AgentEventMap['approval:request']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'approval:request', ...data });
        };
        this.agentEventBus.on('approval:request', approvalRequestListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'approval:request', listener: approvalRequestListener });

        const approvalResponseListener = (data: AgentEventMap['approval:response']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'approval:response', ...data });
        };
        this.agentEventBus.on('approval:response', approvalResponseListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'approval:response', listener: approvalResponseListener });

        // Tool running event - emitted when tool execution starts (after approval if needed)
        const toolRunningListener = (data: AgentEventMap['tool:running']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'tool:running', ...data });
        };
        this.agentEventBus.on('tool:running', toolRunningListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'tool:running', listener: toolRunningListener });

        // Context compaction events - emitted when context is being compacted
        const contextCompactingListener = (data: AgentEventMap['context:compacting']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'context:compacting', ...data });
        };
        this.agentEventBus.on('context:compacting', contextCompactingListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'context:compacting', listener: contextCompactingListener });

        const contextCompactedListener = (data: AgentEventMap['context:compacted']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'context:compacted', ...data });
        };
        this.agentEventBus.on('context:compacted', contextCompactedListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'context:compacted', listener: contextCompactedListener });

        // Message queue events (for mid-task user guidance)
        const messageQueuedListener = (data: AgentEventMap['message:queued']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'message:queued', ...data });
        };
        this.agentEventBus.on('message:queued', messageQueuedListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'message:queued', listener: messageQueuedListener });

        const messageDequeuedListener = (data: AgentEventMap['message:dequeued']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'message:dequeued', ...data });
        };
        this.agentEventBus.on('message:dequeued', messageDequeuedListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'message:dequeued', listener: messageDequeuedListener });

        // Service events - extensible pattern for non-core services (e.g., sub-agent progress)
        const serviceEventListener = (data: AgentEventMap['service:event']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'service:event', ...data });
        };
        this.agentEventBus.on('service:event', serviceEventListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'service:event', listener: serviceEventListener });

        // Run lifecycle event - emitted when TurnExecutor truly finishes
        // This is when we close the iterator (not on llm:response)
        const runCompleteListener = (data: AgentEventMap['run:complete']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'run:complete', ...data });
            completed = true; // NOW close the iterator
        };
        this.agentEventBus.on('run:complete', runCompleteListener, {
            signal: cleanupSignal,
        });
        listeners.push({ event: 'run:complete', listener: runCompleteListener });

        // Start streaming in background (fire-and-forget)
        (async () => {
            // Propagate sessionId through OpenTelemetry context for distributed tracing
            const activeContext = context.active();
            const activeSpan = trace.getActiveSpan();

            // Add sessionId to span attributes
            if (activeSpan) {
                activeSpan.setAttribute('sessionId', sessionId);
            }

            // Preserve existing baggage entries and add sessionId
            const existingBaggage = propagation.getBaggage(activeContext);
            const baggageEntries: Record<string, BaggageEntry> = {};
            if (existingBaggage) {
                existingBaggage.getAllEntries().forEach(([key, entry]) => {
                    baggageEntries[key] = { ...entry };
                });
            }
            baggageEntries.sessionId = { ...baggageEntries.sessionId, value: sessionId };

            const updatedContext = propagation.setBaggage(
                activeContext,
                propagation.createBaggage(baggageEntries)
            );

            // Execute within updated OpenTelemetry context
            await context.with(updatedContext, async () => {
                try {
                    // Get session-specific LLM config for validation
                    const llmConfig = this.stateManager.getLLMConfig(sessionId);

                    // Extract parts for validation
                    const textParts = contentParts.filter(
                        (p): p is import('./types.js').TextPart => p.type === 'text'
                    );
                    const textContent = textParts.map((p) => p.text).join('\n');
                    const imageParts = contentParts.filter(
                        (p): p is import('./types.js').ImagePart => p.type === 'image'
                    );
                    const fileParts = contentParts.filter(
                        (p): p is import('./types.js').FilePart => p.type === 'file'
                    );

                    this.logger.debug(
                        `DextoAgent.stream: sessionId=${sessionId}, textLength=${textContent?.length ?? 0}, imageCount=${imageParts.length}, fileCount=${fileParts.length}`
                    );

                    // Validate ALL inputs early using session-specific config
                    // Validate text first (once)
                    const textValidation = validateInputForLLM(
                        { text: textContent },
                        { provider: llmConfig.provider, model: llmConfig.model },
                        this.logger
                    );
                    ensureOk(textValidation, this.logger);

                    // Validate each image
                    for (const imagePart of imageParts) {
                        const imageValidation = validateInputForLLM(
                            {
                                imageData: {
                                    image:
                                        typeof imagePart.image === 'string'
                                            ? imagePart.image
                                            : imagePart.image.toString(),
                                    mimeType: imagePart.mimeType || 'image/png',
                                },
                            },
                            { provider: llmConfig.provider, model: llmConfig.model },
                            this.logger
                        );
                        ensureOk(imageValidation, this.logger);
                    }

                    // Validate each file
                    for (const filePart of fileParts) {
                        const fileValidation = validateInputForLLM(
                            {
                                fileData: {
                                    data:
                                        typeof filePart.data === 'string'
                                            ? filePart.data
                                            : filePart.data.toString(),
                                    mimeType: filePart.mimeType,
                                },
                            },
                            { provider: llmConfig.provider, model: llmConfig.model },
                            this.logger
                        );
                        ensureOk(fileValidation, this.logger);
                    }

                    // Expand @resource mentions - returns ALL images as ContentPart[]
                    if (textContent.includes('@')) {
                        try {
                            const resources = await this.resourceManager.list();
                            const expansion = await expandMessageReferences(
                                textContent,
                                resources,
                                (uri) => this.resourceManager.read(uri)
                            );

                            // Warn about unresolved references
                            if (expansion.unresolvedReferences.length > 0) {
                                const unresolvedNames = expansion.unresolvedReferences
                                    .map((ref) => ref.originalRef)
                                    .join(', ');
                                this.logger.warn(
                                    `Could not resolve ${expansion.unresolvedReferences.length} resource reference(s): ${unresolvedNames}`
                                );
                            }

                            // Validate expanded message size (5MB limit)
                            const MAX_EXPANDED_SIZE = 5 * 1024 * 1024; // 5MB
                            const expandedSize = Buffer.byteLength(
                                expansion.expandedMessage,
                                'utf-8'
                            );
                            if (expandedSize > MAX_EXPANDED_SIZE) {
                                this.logger.warn(
                                    `Expanded message size (${(expandedSize / 1024 / 1024).toFixed(2)}MB) exceeds limit (${MAX_EXPANDED_SIZE / 1024 / 1024}MB). Content may be truncated.`
                                );
                            }

                            // Update text parts with expanded message
                            contentParts = contentParts.filter((p) => p.type !== 'text');
                            if (expansion.expandedMessage.trim()) {
                                contentParts.unshift({
                                    type: 'text',
                                    text: expansion.expandedMessage,
                                });
                            }

                            // Add ALL extracted images to content parts
                            for (const img of expansion.extractedImages) {
                                contentParts.push({
                                    type: 'image',
                                    image: img.image,
                                    mimeType: img.mimeType,
                                });
                                this.logger.debug(
                                    `Added extracted image: ${img.name} (${img.mimeType})`
                                );
                            }
                        } catch (error) {
                            this.logger.error(
                                `Failed to expand resource references: ${error instanceof Error ? error.message : String(error)}. Continuing with original message.`
                            );
                        }
                    }

                    // Validate that we have content after expansion - fallback to original if empty
                    const hasTextContent = contentParts.some(
                        (p) => p.type === 'text' && p.text.trim()
                    );
                    const hasMediaContent = contentParts.some(
                        (p) => p.type === 'image' || p.type === 'file'
                    );
                    if (!hasTextContent && !hasMediaContent) {
                        this.logger.warn(
                            'Resource expansion resulted in empty content. Using original message.'
                        );
                        contentParts = [{ type: 'text', text: textContent }];
                    }

                    // Get or create session
                    const session: ChatSession =
                        (await this.sessionManager.getSession(sessionId)) ||
                        (await this.sessionManager.createSession(sessionId));

                    // Call session.stream() directly with ALL content parts
                    const _streamResult = await session.stream(
                        contentParts,
                        signal ? { signal } : undefined
                    );

                    // Increment message count
                    this.sessionManager
                        .incrementMessageCount(session.id)
                        .catch((error) =>
                            this.logger.warn(
                                `Failed to increment message count: ${error instanceof Error ? error.message : String(error)}`
                            )
                        );
                } catch (err) {
                    // Preserve typed errors, wrap unknown values in AgentError.streamFailed
                    const error =
                        err instanceof DextoRuntimeError || err instanceof DextoValidationError
                            ? err
                            : err instanceof Error
                              ? err
                              : AgentError.streamFailed(String(err));
                    completed = true;
                    this.logger.error(`Error in DextoAgent.stream: ${error.message}`);

                    const errorEvent: { name: 'llm:error' } & AgentEventMap['llm:error'] = {
                        name: 'llm:error',
                        error,
                        recoverable: false,
                        context: 'run_failed',
                        sessionId,
                    };
                    eventQueue.push(errorEvent);
                }
            });
        })();

        // Return async iterable iterator
        const iterator: AsyncIterableIterator<StreamingEvent> = {
            async next(): Promise<IteratorResult<StreamingEvent>> {
                // Wait for events
                while (!completed && eventQueue.length === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));

                    // Check for abort (external signal OR internal via cancel())
                    if (signal?.aborted || cleanupSignal.aborted) {
                        cleanupListeners();
                        controller.abort();
                        return { done: true, value: undefined };
                    }
                }

                // Return queued events
                if (eventQueue.length > 0) {
                    return { done: false, value: eventQueue.shift()! };
                }

                // Stream completed
                if (completed) {
                    cleanupListeners();
                    controller.abort();
                    return { done: true, value: undefined };
                }

                // Shouldn't reach here
                cleanupListeners();
                return { done: true, value: undefined };
            },

            async return(): Promise<IteratorResult<StreamingEvent>> {
                // Called when consumer breaks out early or explicitly calls return()
                cleanupListeners();
                controller.abort();
                return { done: true, value: undefined };
            },

            [Symbol.asyncIterator]() {
                return iterator;
            },
        };

        return iterator;
    }

    /**
     * Check if a session is currently processing a message.
     * @param sessionId Session id
     * @returns true if the session is busy processing; false otherwise
     */
    public async isSessionBusy(sessionId: string): Promise<boolean> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        return session?.isBusy() ?? false;
    }

    /**
     * Queue a message for processing when a session is busy.
     * The message will be injected into the conversation when the current turn completes.
     *
     * @param sessionId Session id
     * @param message The user message to queue
     * @returns Queue position and message ID
     * @throws Error if session doesn't support message queueing
     */
    public async queueMessage(
        sessionId: string,
        message: import('../session/message-queue.js').UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.queueMessage(message);
    }

    /**
     * Get all queued messages for a session.
     * @param sessionId Session id
     * @returns Array of queued messages
     */
    public async getQueuedMessages(
        sessionId: string
    ): Promise<import('../session/types.js').QueuedMessage[]> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.getQueuedMessages();
    }

    /**
     * Remove a queued message.
     * @param sessionId Session id
     * @param messageId The ID of the queued message to remove
     * @returns true if message was found and removed, false otherwise
     */
    public async removeQueuedMessage(sessionId: string, messageId: string): Promise<boolean> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.removeQueuedMessage(messageId);
    }

    /**
     * Clear all queued messages for a session.
     * @param sessionId Session id
     * @returns Number of messages that were cleared
     */
    public async clearMessageQueue(sessionId: string): Promise<number> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.clearMessageQueue();
    }

    /**
     * Cancels the currently running turn for a session.
     * Safe to call even if no run is in progress.
     * @param sessionId Session id (required)
     * @returns true if a run was in progress and was signaled to abort; false otherwise
     */
    public async cancel(sessionId: string): Promise<boolean> {
        this.ensureStarted();

        // Defensive runtime validation (protects against JavaScript callers, any types, @ts-ignore)
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        // Abort the stream iterator first (so consumer's for-await loop exits cleanly)
        const streamController = this.activeStreamControllers.get(sessionId);
        if (streamController) {
            streamController.abort();
            this.activeStreamControllers.delete(sessionId);
        }

        // Then cancel the session's LLM/tool execution
        const existing = await this.sessionManager.getSession(sessionId, false);
        if (existing) {
            return existing.cancel();
        }
        // If no session found but stream was aborted, still return true
        return !!streamController;
    }

    // ============= WORKSPACE MANAGEMENT =============

    /**
     * Sets the active workspace for this runtime.
     * The workspace context is persisted and emitted via the agent event bus.
     */
    public async setWorkspace(input: SetWorkspaceInput): Promise<WorkspaceContext> {
        this.ensureStarted();
        return await this.workspaceManager.setWorkspace(input);
    }

    /**
     * Gets the currently active workspace, if any.
     */
    public async getWorkspace(): Promise<WorkspaceContext | undefined> {
        this.ensureStarted();
        return await this.workspaceManager.getWorkspace();
    }

    /**
     * Clears the active workspace for this runtime.
     */
    public async clearWorkspace(): Promise<void> {
        this.ensureStarted();
        await this.workspaceManager.clearWorkspace();
    }

    /**
     * Lists all known workspaces in storage.
     */
    public async listWorkspaces(): Promise<WorkspaceContext[]> {
        this.ensureStarted();
        return await this.workspaceManager.listWorkspaces();
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
        // Clear session-level auto-approve tools to prevent memory leak
        this.toolManager.clearSessionAutoApproveTools(sessionId);
        return this.sessionManager.endSession(sessionId);
    }

    /**
     * Deletes a session and its conversation history permanently.
     * Used for user-initiated permanent deletion.
     * @param sessionId The session ID to delete
     */
    public async deleteSession(sessionId: string): Promise<void> {
        this.ensureStarted();
        // Clear session-level auto-approve tools to prevent memory leak
        this.toolManager.clearSessionAutoApproveTools(sessionId);
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
     * Generate a title for a session on-demand.
     * Uses the first user message content to generate a descriptive title.
     *
     * @param sessionId Session ID to generate title for
     * @returns Promise that resolves to the generated title, or null if generation failed
     */
    public async generateSessionTitle(sessionId: string): Promise<string | null> {
        this.ensureStarted();

        // Get session metadata to check if title already exists
        const metadata = await this.sessionManager.getSessionMetadata(sessionId);
        if (!metadata) {
            throw SessionError.notFound(sessionId);
        }
        if (metadata.title) {
            this.logger.debug(
                `[SessionTitle] Session ${sessionId} already has title '${metadata.title}'`
            );
            return metadata.title;
        }

        // Get first user message
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        const history = await session.getHistory();
        const firstUserMsg = history.find((m) => m.role === 'user');
        if (!firstUserMsg) {
            this.logger.debug(`[SessionTitle] No user message found for session ${sessionId}`);
            return null;
        }

        const userText =
            typeof firstUserMsg.content === 'string'
                ? firstUserMsg.content
                : firstUserMsg.content
                      ?.filter((p) => p.type === 'text')
                      .map((p: { type: string; text: string }) => p.text)
                      .join(' ');

        if (!userText || !userText.trim()) {
            this.logger.debug(`[SessionTitle] Empty user text for session ${sessionId}`);
            return null;
        }

        // Get LLM config for the session
        const llmConfig = this.getEffectiveConfig(sessionId).llm;

        // Generate title
        const result = await generateSessionTitle(
            llmConfig,
            this.toolManager,
            this.systemPromptManager,
            this.resourceManager,
            userText,
            this.logger
        );

        let title = result.title;
        if (!title) {
            // Fallback to heuristic
            title = deriveHeuristicTitle(userText);
            if (title) {
                this.logger.info(`[SessionTitle] Using heuristic title for ${sessionId}: ${title}`);
            } else {
                this.logger.debug(`[SessionTitle] No suitable title derived for ${sessionId}`);
                return null;
            }
        } else {
            this.logger.info(`[SessionTitle] Generated LLM title for ${sessionId}: ${title}`);
        }

        // Save title
        await this.sessionManager.setSessionTitle(sessionId, title, { ifUnsetOnly: true });

        return title;
    }

    /**
     * Gets the conversation history for a specific session.
     * @param sessionId The session ID
     * @returns Promise that resolves to the session's conversation history
     * @throws Error if session doesn't exist
     */
    public async getSessionHistory(sessionId: string): Promise<InternalMessage[]> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        const history = await session.getHistory();
        if (!this.resourceManager) {
            return history;
        }

        return (await Promise.all(
            history.map(async (message) => ({
                ...message,
                content: await expandBlobReferences(
                    message.content,
                    this.resourceManager,
                    this.logger
                ).catch((error) => {
                    this.logger.warn(
                        `Failed to expand blob references in message: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return message.content; // Return original content on error
                }),
            }))
        )) as InternalMessage[];
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
     * Resets the conversation history for a specific session.
     * Keeps the session alive but the conversation history is cleared.
     * @param sessionId Session ID (required)
     */
    public async resetConversation(sessionId: string): Promise<void> {
        this.ensureStarted();

        // Defensive runtime validation (protects against JavaScript callers, any types, @ts-ignore)
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        try {
            // Use SessionManager's resetSession method for better consistency
            await this.sessionManager.resetSession(sessionId);

            this.logger.info(`DextoAgent conversation reset for session: ${sessionId}`);
            this.agentEventBus.emit('session:reset', {
                sessionId: sessionId,
            });
        } catch (error) {
            this.logger.error(
                `Error during DextoAgent.resetConversation: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Clears the context window for a session without deleting history.
     *
     * This adds a "context clear" marker to the conversation history. When the
     * context is loaded for LLM, messages before this marker are filtered out
     * (via filterCompacted). The full history remains in the database for
     * review via /resume or session history.
     *
     * Use this for /clear command - it preserves history but gives a fresh
     * context window to the LLM.
     *
     * @param sessionId Session ID (required)
     */
    public async clearContext(sessionId: string): Promise<void> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        const contextManager = session.getContextManager();
        await contextManager.clearContext();

        this.logger.info(`Context cleared for session: ${sessionId}`);
        this.agentEventBus.emit('context:cleared', {
            sessionId,
        });
    }

    /**
     * Manually compact the context for a session.
     *
     * Compaction generates a summary of older messages and adds it to the conversation history.
     * When the context is loaded, filterCompacted() will exclude messages before the summary,
     * effectively reducing the context window while preserving the full history in storage.
     *
     * @param sessionId Session ID of the session to compact (required)
     * @returns Compaction result with stats, or null if compaction was skipped
     */
    public async compactContext(sessionId: string): Promise<{
        /** The session that was compacted */
        sessionId: string;
        /** Estimated tokens in context after compaction (includes system prompt, tools, and messages) */
        compactedContextTokens: number;
        /** Number of messages before compaction */
        originalMessages: number;
        /** Number of messages after compaction (summary + preserved) */
        compactedMessages: number;
    } | null> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        // Get compaction strategy from the session's LLM service
        const llmService = session.getLLMService();
        const compactionStrategy = llmService.getCompactionStrategy();

        if (!compactionStrategy) {
            this.logger.warn(
                `Compaction strategy not configured for session ${sessionId} - skipping manual compaction`
            );
            return null;
        }

        // Get history and generate summary
        const contextManager = session.getContextManager();
        const history = await contextManager.getHistory();

        if (history.length < 4) {
            this.logger.debug(`Compaction skipped for session ${sessionId} - history too short`);
            return null;
        }

        // Get full context estimate BEFORE compaction (includes system prompt, tools, messages)
        // This uses the same calculation as /context command for consistency
        const contributorContext = { mcpManager: this.mcpManager };
        const tools = await llmService.getEnabledTools();
        const beforeEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const originalTokens = beforeEstimate.estimated;
        const originalMessages = beforeEstimate.stats.filteredMessageCount;

        // Emit compacting event
        this.agentEventBus.emit('context:compacting', {
            estimatedTokens: originalTokens,
            sessionId,
        });

        // Generate summary message(s)
        const summaryMessages = await compactionStrategy.compact(history, {
            sessionId,
            model: llmService.getLanguageModel(),
            logger: session.logger,
        });

        if (summaryMessages.length === 0) {
            this.logger.debug(`Compaction skipped for session ${sessionId} - nothing to compact`);
            this.agentEventBus.emit('context:compacted', {
                originalTokens,
                compactedTokens: originalTokens,
                originalMessages,
                compactedMessages: originalMessages,
                strategy: compactionStrategy.name,
                reason: 'manual',
                sessionId,
            });
            return null;
        }

        // Add summary to history - filterCompacted() will exclude pre-summary messages at read-time
        for (const summary of summaryMessages) {
            await contextManager.addMessage(summary);
        }

        // Reset actual token tracking since context has fundamentally changed
        // The formula (lastInput + lastOutput + newEstimate) is no longer valid after compaction
        contextManager.resetActualTokenTracking();

        // Get full context estimate AFTER compaction (uses pure estimation since actuals were reset)
        // This ensures /context will show the same value
        const afterEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const compactedTokens = afterEstimate.estimated;
        const compactedMessages = afterEstimate.stats.filteredMessageCount;

        this.agentEventBus.emit('context:compacted', {
            originalTokens,
            compactedTokens,
            originalMessages,
            compactedMessages,
            strategy: compactionStrategy.name,
            reason: 'manual',
            sessionId,
        });

        this.logger.info(
            `Compaction complete for session ${sessionId}: ` +
                `${originalMessages} messages → ${compactedMessages} messages (~${compactedTokens} tokens)`
        );

        return {
            sessionId,
            compactedContextTokens: compactedTokens,
            originalMessages,
            compactedMessages,
        };
    }

    /**
     * Get context usage statistics for a session.
     * Useful for monitoring context window usage and compaction status.
     *
     * @param sessionId Session ID (required)
     * @returns Context statistics including token estimates and message counts
     */
    public async getContextStats(sessionId: string): Promise<{
        estimatedTokens: number;
        /** Last actual token count from LLM API (null if no calls made yet) */
        actualTokens: number | null;
        /** Effective max context tokens (after applying maxContextTokens override and thresholdPercent) */
        maxContextTokens: number;
        /** The model's raw context window before any config overrides */
        modelContextWindow: number;
        /** Configured threshold percent (0.0-1.0), defaults to 1.0 */
        thresholdPercent: number;
        usagePercent: number;
        messageCount: number;
        filteredMessageCount: number;
        prunedToolCount: number;
        hasSummary: boolean;
        /** Current model identifier */
        model: string;
        /** Display name for the model */
        modelDisplayName: string;
        /** Detailed breakdown of context usage by category */
        breakdown: {
            systemPrompt: number;
            tools: {
                total: number;
                /** Per-tool token estimates */
                perTool: Array<{ name: string; tokens: number }>;
            };
            messages: number;
        };
        /** Calculation basis showing how the estimate was computed */
        calculationBasis?: {
            /** 'actuals' = used lastInput + lastOutput + newEstimate, 'estimate' = pure estimation */
            method: 'actuals' | 'estimate';
            /** Last actual input tokens from API (if method is 'actuals') */
            lastInputTokens?: number;
            /** Last actual output tokens from API (if method is 'actuals') */
            lastOutputTokens?: number;
            /** Estimated tokens for new messages since last call (if method is 'actuals') */
            newMessagesEstimate?: number;
        };
    }> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        const contextManager = session.getContextManager();

        // Get token estimate using ContextManager's method (single source of truth)
        const contributorContext = { mcpManager: this.mcpManager };
        const llmService = session.getLLMService();
        const tools = await llmService.getEnabledTools();

        const tokenEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );

        // Get raw history for hasSummary check
        const history = await contextManager.getHistory();
        // Get the effective max context tokens from the injected compaction strategy (if any)
        const runtimeConfig = this.stateManager.getRuntimeConfig(sessionId);
        const modelContextWindow = contextManager.getMaxInputTokens();
        const compactionStrategy = this.injectedCompactionStrategy;
        const compactionSettings = compactionStrategy?.getSettings();
        const thresholdPercent =
            compactionSettings && compactionSettings.enabled
                ? compactionSettings.thresholdPercent
                : 1.0;
        const modelLimits = compactionStrategy
            ? compactionStrategy.getModelLimits(modelContextWindow)
            : { contextWindow: modelContextWindow };
        const maxContextTokens =
            thresholdPercent < 1.0
                ? Math.floor(modelLimits.contextWindow * thresholdPercent)
                : modelLimits.contextWindow;

        // Check if there's a summary in history (old isSummary or new isSessionSummary marker)
        const hasSummary = history.some(
            (msg) => msg.metadata?.isSummary === true || msg.metadata?.isSessionSummary === true
        );

        // Get model info for display
        const llmConfig = runtimeConfig.llm;
        const { getModelDisplayName } = await import('../llm/registry/index.js');
        const modelDisplayName = getModelDisplayName(llmConfig.model, llmConfig.provider);

        // Always use the calculated estimate (which includes lastInput + lastOutput + newMessages when actuals available)
        const estimatedTokens = tokenEstimate.estimated;

        const autoCompactBuffer =
            thresholdPercent > 0 && thresholdPercent < 1.0
                ? Math.floor((maxContextTokens * (1 - thresholdPercent)) / thresholdPercent)
                : 0;
        const totalTokenSpace = maxContextTokens + autoCompactBuffer;
        const usedTokens = estimatedTokens + autoCompactBuffer;

        return {
            estimatedTokens,
            actualTokens: tokenEstimate.actual,
            maxContextTokens,
            modelContextWindow,
            thresholdPercent,
            usagePercent:
                totalTokenSpace > 0 ? Math.round((usedTokens / totalTokenSpace) * 100) : 0,
            messageCount: tokenEstimate.stats.originalMessageCount,
            filteredMessageCount: tokenEstimate.stats.filteredMessageCount,
            prunedToolCount: tokenEstimate.stats.prunedToolCount,
            hasSummary,
            model: llmConfig.model,
            modelDisplayName,
            breakdown: {
                systemPrompt: tokenEstimate.breakdown.systemPrompt,
                tools: tokenEstimate.breakdown.tools,
                messages: tokenEstimate.breakdown.messages,
            },
            ...(tokenEstimate.calculationBasis && {
                calculationBasis: tokenEstimate.calculationBasis,
            }),
        };
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Gets the current LLM configuration with all defaults applied.
     * @param sessionId Optional session ID to get config for specific session
     * @returns Current LLM configuration
     */
    public getCurrentLLMConfig(sessionId?: string): ValidatedLLMConfig {
        this.ensureStarted();
        if (sessionId !== undefined && (!sessionId || typeof sessionId !== 'string')) {
            throw AgentError.apiValidationError(
                'sessionId must be a non-empty string when provided'
            );
        }
        return structuredClone(this.stateManager.getLLMConfig(sessionId));
    }

    /**
     * Switches the LLM service while preserving conversation history.
     * This is a comprehensive method that handles ALL validation, configuration building, and switching internally.
     *
     * Design:
     * - Input: Partial<LLMConfig> (allows optional fields like maxIterations?)
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
     * // Switch with session options
     * await agent.switchLLM({ provider: 'anthropic', model: 'claude-4-sonnet-20250514' }, 'user-123');
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
        this.logger.debug(`DextoAgent.switchLLM: llmUpdates: ${safeStringify(llmUpdates)}`);
        const parseResult = LLMUpdatesSchema.safeParse(llmUpdates);
        if (!parseResult.success) {
            const validation = fail(zodToIssues(parseResult.error, 'error'));
            ensureOk(validation, this.logger); // This will throw DextoValidationError
            throw new Error('Unreachable'); // For TypeScript
        }
        const validatedUpdates = parseResult.data;

        // Get current config for the session
        const currentLLMConfig = sessionId
            ? this.stateManager.getRuntimeConfig(sessionId).llm
            : this.stateManager.getRuntimeConfig().llm;

        // Build and validate the new configuration using Result pattern internally
        const result = await resolveAndValidateLLMConfig(
            currentLLMConfig,
            validatedUpdates,
            this.logger
        );
        const validatedConfig = ensureOk(result, this.logger);

        // Perform the actual LLM switch with validated config
        await this.performLLMSwitch(validatedConfig, sessionId);
        this.logger.info(
            `DextoAgent.switchLLM: LLM switched to: ${safeStringify(validatedConfig)}`
        );

        // Log warnings if present
        const warnings = result.issues.filter((issue) => issue.severity === 'warning');
        if (warnings.length > 0) {
            this.logger.warn(
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
            // No sessionScope provided - this is a configuration-level switch only
            // State manager has been updated, individual sessions will pick up changes when created
            this.logger.debug('LLM config updated at agent level (no active session switches)');
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
        return getSupportedProviders();
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
    public getSupportedModels(): Record<
        LLMProvider,
        Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }>
    > {
        const result = {} as Record<
            LLMProvider,
            Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }>
        >;

        for (const provider of this.getSupportedProviders()) {
            result[provider] = this.getSupportedModelsForProvider(provider);
        }

        return result;
    }

    /**
     * Gets supported models for a specific provider.
     * Returns model information including metadata for the specified provider only.
     * For gateway providers like 'dexto-nova' with supportsAllRegistryModels, returns
     * all models from all accessible providers with their original provider info.
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
    ): Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }> {
        const models = getAllModelsForProvider(provider);

        return models.map((model) => {
            // For inherited models, get default from the original provider
            const originalProvider =
                'originalProvider' in model ? model.originalProvider : provider;
            const defaultModel = getDefaultModelForProvider(originalProvider ?? provider);

            return {
                ...model,
                isDefault: model.name === defaultModel,
            };
        });
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
     * Adds a new MCP server to the runtime configuration and connects it if enabled.
     * This method handles validation, state management, and establishing the connection.
     *
     * @param name The name of the server to add.
     * @param config The configuration object for the server.
     * @throws DextoError if validation fails or connection fails
     */
    public async addMcpServer(name: string, config: McpServerConfig): Promise<void> {
        this.ensureStarted();

        // Validate the server configuration
        const existingServerNames = Object.keys(this.stateManager.getRuntimeConfig().mcpServers);
        const validation = resolveAndValidateMcpServerConfig(name, config, existingServerNames);
        const validatedConfig = ensureOk(validation, this.logger);

        // Add to runtime state (no validation needed - already validated)
        this.stateManager.setMcpServer(name, validatedConfig);

        // Only connect if server is enabled (default is true)
        if (validatedConfig.enabled === false) {
            this.logger.info(`MCP server '${name}' added but not connected (disabled)`);
            return;
        }

        try {
            // Connect the server
            await this.mcpManager.connectServer(name, validatedConfig);

            // Ensure tool cache reflects the newly connected server before notifying listeners
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', {
                name,
                success: true,
            });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`MCP server '${name}' added and connected successfully`);

            // Log warnings if present
            const warnings = validation.issues.filter((i) => i.severity === 'warning');
            if (warnings.length > 0) {
                this.logger.warn(
                    `MCP server connected with warnings: ${warnings.map((w) => w.message).join(', ')}`
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to connect MCP server '${name}': ${errorMessage}`);

            // Clean up state if connection failed
            this.stateManager.removeMcpServer(name);

            this.agentEventBus.emit('mcp:server-connected', {
                name,
                success: false,
                error: errorMessage,
            });

            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    /**
     * Updates an existing MCP server configuration and reconnects if needed.
     * This is used when editing server params (timeout, headers, env, etc.).
     *
     * @param name The name of the server to update.
     * @param config The updated configuration object.
     * @throws MCPError if validation fails or reconnect fails.
     */
    public async updateMcpServer(name: string, config: McpServerConfig): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        const existingServerNames = Object.keys(this.stateManager.getRuntimeConfig().mcpServers);
        const validation = resolveAndValidateMcpServerConfig(name, config, existingServerNames);
        const validatedConfig = ensureOk(validation, this.logger);

        // Update runtime state first so the latest config is visible
        this.stateManager.setMcpServer(name, validatedConfig);

        const shouldEnable = validatedConfig.enabled !== false;
        const hasClient = this.mcpManager.getClients().has(name);

        if (!shouldEnable) {
            if (hasClient) {
                await this.mcpManager.removeClient(name);
                await this.toolManager.refresh();
            }
            this.logger.info(`MCP server '${name}' updated (disabled)`);
            return;
        }

        try {
            if (hasClient) {
                await this.mcpManager.removeClient(name);
            }

            await this.mcpManager.connectServer(name, validatedConfig);
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', { name, success: true });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`MCP server '${name}' updated and reconnected successfully`);

            const warnings = validation.issues.filter((i) => i.severity === 'warning');
            if (warnings.length > 0) {
                this.logger.warn(
                    `MCP server updated with warnings: ${warnings.map((w) => w.message).join(', ')}`
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to update MCP server '${name}': ${errorMessage}`);

            // Best-effort revert to previous config
            this.stateManager.setMcpServer(name, currentConfig);
            if (currentConfig.enabled !== false) {
                try {
                    await this.mcpManager.connectServer(name, currentConfig);
                    await this.toolManager.refresh();
                } catch (reconnectError) {
                    const reconnectMsg =
                        reconnectError instanceof Error
                            ? reconnectError.message
                            : String(reconnectError);
                    this.logger.error(
                        `Failed to restore MCP server '${name}' after update error: ${reconnectMsg}`
                    );
                }
            }

            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    /**
     * @deprecated Use `addMcpServer` instead. This method will be removed in a future version.
     */
    public async connectMcpServer(name: string, config: McpServerConfig): Promise<void> {
        return this.addMcpServer(name, config);
    }

    /**
     * Enables a disabled MCP server and connects it.
     * Updates the runtime state to enabled=true and establishes the connection.
     *
     * @param name The name of the server to enable.
     * @throws MCPError if server is not found or connection fails
     */
    public async enableMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        // Update state with enabled=true
        const updatedConfig = { ...currentConfig, enabled: true };
        this.stateManager.setMcpServer(name, updatedConfig);

        try {
            // Connect the server
            await this.mcpManager.connectServer(name, updatedConfig);
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', { name, success: true });
            this.logger.info(`MCP server '${name}' enabled and connected`);
        } catch (error) {
            // Revert state on failure
            this.stateManager.setMcpServer(name, currentConfig);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to enable MCP server '${name}': ${errorMessage}`);
            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    /**
     * Disables an MCP server and disconnects it.
     * Updates the runtime state to enabled=false and closes the connection.
     *
     * @param name The name of the server to disable.
     * @throws MCPError if server is not found or disconnect fails
     */
    public async disableMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        // Update state with enabled=false
        const updatedConfig = { ...currentConfig, enabled: false };
        this.stateManager.setMcpServer(name, updatedConfig);

        try {
            // Disconnect the server
            await this.mcpManager.removeClient(name);
            await this.toolManager.refresh();

            this.logger.info(`MCP server '${name}' disabled and disconnected`);
        } catch (error) {
            // Revert state on failure
            this.stateManager.setMcpServer(name, currentConfig);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to disable MCP server '${name}': ${errorMessage}`);
            throw MCPError.disconnectionFailed(name, errorMessage);
        }
    }

    /**
     * Removes and disconnects an MCP server completely.
     * Use this for deleting a server - removes from both runtime state and disconnects.
     * @param name The name of the server to remove.
     * @throws MCPError if disconnection fails
     */
    public async removeMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        try {
            // Disconnect the client first
            await this.mcpManager.removeClient(name);

            // Then remove from runtime state
            this.stateManager.removeMcpServer(name);

            // Refresh tool cache after server removal so the LLM sees updated set
            await this.toolManager.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to remove MCP server '${name}': ${errorMessage}`);
            throw MCPError.disconnectionFailed(name, errorMessage);
        }
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
            this.logger.info(`DextoAgent: Restarting MCP server '${name}'...`);

            // Restart the server using MCPManager
            await this.mcpManager.restartServer(name);

            // Refresh tool cache after restart so the LLM sees updated toolset
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-restarted', {
                serverName: name,
            });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`DextoAgent: Successfully restarted MCP server '${name}'.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `DextoAgent: Failed to restart MCP server '${name}': ${errorMessage}`
            );

            // Note: No event emitted on failure since the error is thrown
            // The calling layer (API) will handle error reporting

            throw error;
        }
    }

    public getMcpAuthProvider(name: string) {
        if (!name || typeof name !== 'string') {
            throw AgentError.apiValidationError('name is required and must be a non-empty string');
        }
        this.ensureStarted();
        return this.mcpManager.getAuthProvider(name);
    }

    /**
     * Executes a tool from any source (MCP servers, custom tools, or internal tools).
     * This is the unified interface for tool execution that can handle all tool types.
     *
     * Note: This is for direct/programmatic tool execution outside of LLM flow.
     * A toolCallId is generated automatically for tracking purposes.
     *
     * @param toolName The name of the tool to execute
     * @param args The arguments to pass to the tool
     * @returns The result of the tool execution
     */
    public async executeTool(toolName: string, args: any): Promise<any> {
        this.ensureStarted();
        // Generate a toolCallId for direct API calls (not from LLM)
        const toolCallId = `direct-${randomUUID()}`;
        return await this.toolManager.executeTool(toolName, args, toolCallId);
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
     * Gets all MCP tools with their server metadata.
     * Returns tool cache entries which include server names for proper grouping.
     * @returns Map of tool names to cache entries with server info
     */
    public getAllMcpToolsWithServerInfo() {
        this.ensureStarted();
        return this.mcpManager.getAllToolsWithServerInfo();
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
     * Gets tools enabled for LLM context (applies session overrides + global preferences).
     */
    public async getEnabledTools(sessionId?: string): Promise<ToolSet> {
        this.ensureStarted();
        if (sessionId !== undefined && (!sessionId || typeof sessionId !== 'string')) {
            throw AgentError.apiValidationError('sessionId must be a non-empty string');
        }
        return this.toolManager.filterToolsForSession(
            await this.toolManager.getAllTools(),
            sessionId
        );
    }

    /**
     * Get global disabled tools (agent preferences).
     */
    public getGlobalDisabledTools(): string[] {
        this.ensureStarted();
        return this.toolManager.getGlobalDisabledTools();
    }

    /**
     * Set global disabled tools (agent preferences).
     */
    public setGlobalDisabledTools(toolNames: string[]): void {
        this.ensureStarted();
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        this.toolManager.setGlobalDisabledTools(toolNames);
    }

    /**
     * Set session-level disabled tools (session override).
     */
    public setSessionDisabledTools(sessionId: string, toolNames: string[]): void {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        this.toolManager.setSessionDisabledTools(sessionId, toolNames);
    }

    /**
     * Clear session-level disabled tools (session override).
     */
    public clearSessionDisabledTools(sessionId: string): void {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        this.toolManager.clearSessionDisabledTools(sessionId);
    }

    /**
     * Get session-level auto-approve tools.
     */
    public getSessionAutoApproveTools(sessionId: string): string[] {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        return this.toolManager.getSessionUserAutoApproveTools(sessionId) ?? [];
    }

    /**
     * Set session-level auto-approve tools (user selection).
     */
    public setSessionAutoApproveTools(sessionId: string, toolNames: string[]): void {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        this.toolManager.setSessionUserAutoApproveTools(sessionId, toolNames);
    }

    /**
     * Gets all connected MCP clients.
     * Used by the API layer to inspect client status.
     * @returns Map of client names to client instances
     */
    public getMcpClients(): Map<string, McpClient> {
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
        const failures = this.mcpManager.getFailedConnections();
        return Object.fromEntries(
            Object.entries(failures).map(([name, error]) => [name, error.message])
        );
    }

    /**
     * Gets the connection status of a single MCP server.
     * @param name The server name
     * @returns The connection status, or undefined if server not configured
     *
     * TODO: Move to MCPManager once it has access to server configs (enabled state).
     * Currently here because MCPManager only tracks connections, not config.
     */
    public getMcpServerStatus(name: string): McpServerStatus | undefined {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig();
        const serverConfig = config.mcpServers[name];
        if (!serverConfig) return undefined;

        const enabled = serverConfig.enabled !== false;
        const connectedClients = this.mcpManager.getClients();
        const failedConnections = this.mcpManager.getFailedConnections();

        let status: McpConnectionStatus;
        if (!enabled) {
            status = 'disconnected';
        } else if (connectedClients.has(name)) {
            status = 'connected';
        } else {
            const errorCode = this.mcpManager.getFailedConnectionErrorCode(name);
            if (errorCode === MCPErrorCode.AUTH_REQUIRED) {
                status = 'auth-required';
            } else {
                status = 'error';
            }
        }

        const result: McpServerStatus = {
            name,
            type: serverConfig.type,
            enabled,
            status,
        };
        if (failedConnections[name]) {
            result.error = failedConnections[name].message;
        }
        return result;
    }

    /**
     * Gets all configured MCP servers with their connection status.
     * Centralizes the status computation logic used by CLI, server, and webui.
     * @returns Array of server info with computed status
     *
     * TODO: Move to MCPManager once it has access to server configs (enabled state).
     * Currently here because MCPManager only tracks connections, not config.
     */
    public getMcpServersWithStatus(): McpServerStatus[] {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig();
        const mcpServers = config.mcpServers || {};
        const connectedClients = this.mcpManager.getClients();
        const failedConnections = this.mcpManager.getFailedConnections();

        const servers: McpServerStatus[] = [];

        for (const [name, serverConfig] of Object.entries(mcpServers)) {
            const enabled = serverConfig.enabled !== false;
            let status: McpConnectionStatus;

            if (!enabled) {
                status = 'disconnected';
            } else if (connectedClients.has(name)) {
                status = 'connected';
            } else {
                const errorCode = this.mcpManager.getFailedConnectionErrorCode(name);
                if (errorCode === MCPErrorCode.AUTH_REQUIRED) {
                    status = 'auth-required';
                } else {
                    status = 'error';
                }
            }

            const server: McpServerStatus = {
                name,
                type: serverConfig.type,
                enabled,
                status,
            };
            if (failedConnections[name]) {
                server.error = failedConnections[name].message;
            }
            servers.push(server);
        }

        return servers;
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
     * Refreshes the prompts cache, reloading from all providers.
     * Call this after adding/deleting prompts to make them immediately available.
     *
     * @param newPrompts Optional - if provided, updates the config prompts before refreshing.
     *                   Use this when you've modified the agent config file and need to
     *                   update both the runtime config and refresh the cache.
     */
    public async refreshPrompts(newPrompts?: PromptsConfig): Promise<void> {
        this.ensureStarted();
        if (newPrompts) {
            this.promptManager.updateConfigPrompts(newPrompts);
        }
        await this.promptManager.refresh();
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
     * - Returning per-prompt overrides (allowedTools, model) for the invoker to apply
     *
     * @param name The prompt name or alias
     * @param options Optional configuration for prompt resolution
     * @returns Promise resolving to the resolved text, resource URIs, and optional overrides
     */
    public async resolvePrompt(
        name: string,
        options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {}
    ): Promise<import('../prompts/index.js').ResolvedPromptResult> {
        this.ensureStarted();
        return await this.promptManager.resolvePrompt(name, options);
    }

    // ============= CONFIGURATION ACCESS =============

    /**
     * Gets the effective configuration for a session or the default configuration.
     * @param sessionId Optional session ID. If not provided, returns default config.
     * @returns The effective configuration object (validated with defaults applied)
     * @remarks Requires agent to be started. Use `agent.config` for pre-start access.
     */
    public getEffectiveConfig(sessionId?: string): Readonly<AgentRuntimeSettings> {
        this.ensureStarted();
        return sessionId
            ? this.stateManager.getRuntimeConfig(sessionId)
            : this.stateManager.getRuntimeConfig();
    }

    public getMcpServerConfig(name: string): McpServerConfig | undefined {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (config) return config;
        return this.mcpManager.getServerConfig(name);
    }

    // ============= APPROVAL HANDLER API =============

    /**
     * Set a custom approval handler for manual approval mode.
     *
     * When `toolConfirmation.mode` is set to 'manual', an approval handler must be
     * provided to process tool confirmation requests. The handler will be called
     * whenever a tool execution requires user approval.
     *
     * The handler receives an approval request and must return a promise that resolves
     * to an approval response with the user's decision (approved/denied/cancelled).
     *
     * @param handler The approval handler function
     *
     * @example
     * ```typescript
     * import { ApprovalStatus } from '@dexto/core';
     *
     * agent.setApprovalHandler(async (request) => {
     *   // Present approval request to user (CLI, UI, webhook, etc.)
     *   console.log(`Approve tool: ${request.metadata.toolName}?`);
     *   console.log(`Args: ${JSON.stringify(request.metadata.args)}`);
     *
     *   // Collect user's decision (this is just an example)
     *   const approved = await getUserInput();
     *
     *   return {
     *     approvalId: request.approvalId,
     *     status: approved ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED,
     *     sessionId: request.sessionId,
     *   };
     * });
     * ```
     */
    public setApprovalHandler(handler: ApprovalHandler): void {
        // Store handler for use during start() if not yet started
        this.approvalHandler = handler;

        // If agent is already started, also set it on the service immediately
        if (this._isStarted && this.services) {
            this.services.approvalManager.setHandler(handler);
        }

        this.logger.debug('Approval handler registered');
    }

    public setMcpAuthProviderFactory(
        factory: import('../mcp/types.js').McpAuthProviderFactory | null
    ): void {
        this.mcpAuthProviderFactory = factory;
        if (this._isStarted && this.services) {
            this.services.mcpManager.setAuthProviderFactory(factory);
        }
    }

    /**
     * Clear the current approval handler.
     *
     * After calling this, manual approval mode will fail if a tool requires approval.
     */
    public clearApprovalHandler(): void {
        // Clear stored handler
        this.approvalHandler = undefined;

        // If agent is already started, also clear it on the service
        if (this._isStarted && this.services) {
            this.services.approvalManager.clearHandler();
        }

        this.logger.debug('Approval handler cleared');
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
