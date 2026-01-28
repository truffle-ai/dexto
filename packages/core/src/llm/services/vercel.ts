import { LanguageModel, type ModelMessage } from 'ai';
import { ToolManager } from '../../tools/tool-manager.js';
import { LLMServiceConfig } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { ToolSet } from '../../tools/types.js';
import { ContextManager } from '../../context/manager.js';
import { getEffectiveMaxInputTokens, getMaxInputTokensForModel } from '../registry.js';
import type { ModelLimits } from '../../context/compaction/overflow.js';
import type { CompactionConfigInput } from '../../context/compaction/schemas.js';
import { ContentPart } from '../../context/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { IConversationHistoryProvider } from '../../session/history/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { InstrumentClass } from '../../telemetry/decorators.js';
import { trace, context, propagation } from '@opentelemetry/api';
import { TurnExecutor } from '../executor/turn-executor.js';
import { MessageQueueService } from '../../session/message-queue.js';
import type { ResourceManager } from '../../resources/index.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { LLMErrorCode } from '../error-codes.js';
import type { ContentInput } from '../../agent/types.js';

/**
 * Vercel AI SDK implementation of LLMService
 *
 * This service delegates actual LLM execution to TurnExecutor, which handles:
 * - Tool execution with multimodal support
 * - Streaming with llm:chunk events
 * - Message persistence via StreamProcessor
 * - Reactive compaction on overflow
 * - Tool output pruning
 * - Message queue injection
 *
 * @see TurnExecutor for the main execution loop
 * @see StreamProcessor for stream event handling
 */
@InstrumentClass({
    prefix: 'llm.vercel',
    excludeMethods: ['getModelId', 'getAllTools', 'createTurnExecutor'],
})
export class VercelLLMService {
    private model: LanguageModel;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<ModelMessage>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private logger: IDextoLogger;
    private resourceManager: ResourceManager;
    private messageQueue: MessageQueueService;
    private compactionStrategy:
        | import('../../context/compaction/types.js').ICompactionStrategy
        | null;
    private modelLimits: ModelLimits;
    private compactionThresholdPercent: number;

    /**
     * Helper to extract model ID from LanguageModel union type (string | LanguageModelV2)
     */
    private getModelId(): string {
        return typeof this.model === 'string' ? this.model : this.model.modelId;
    }

    constructor(
        toolManager: ToolManager,
        model: LanguageModel,
        systemPromptManager: SystemPromptManager,
        historyProvider: IConversationHistoryProvider,
        sessionEventBus: SessionEventBus,
        config: ValidatedLLMConfig,
        sessionId: string,
        resourceManager: ResourceManager,
        logger: IDextoLogger,
        compactionStrategy?: import('../../context/compaction/types.js').ICompactionStrategy | null,
        compactionConfig?: CompactionConfigInput
    ) {
        this.logger = logger.createChild(DextoLogComponent.LLM);
        this.model = model;
        this.config = config;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;
        this.resourceManager = resourceManager;
        this.compactionStrategy = compactionStrategy ?? null;
        this.compactionThresholdPercent = compactionConfig?.thresholdPercent ?? 0.9;

        // Create session-level message queue for mid-task user messages
        this.messageQueue = new MessageQueueService(this.sessionEventBus, this.logger);

        // Create properly-typed ContextManager for Vercel
        const formatter = new VercelMessageFormatter(this.logger);
        const maxInputTokens = getEffectiveMaxInputTokens(config, this.logger);

        // Set model limits for compaction overflow detection
        // - maxContextTokens overrides the model's context window
        // - thresholdPercent is applied separately in isOverflow() to trigger before 100%
        let effectiveContextWindow = maxInputTokens;

        // Apply maxContextTokens override if set (cap the context window)
        if (compactionConfig?.maxContextTokens !== undefined) {
            effectiveContextWindow = Math.min(maxInputTokens, compactionConfig.maxContextTokens);
            this.logger.debug(
                `Compaction: Using maxContextTokens override: ${compactionConfig.maxContextTokens} (model max: ${maxInputTokens})`
            );
        }

        // NOTE: thresholdPercent is NOT applied here - it's only applied in isOverflow()
        // to trigger compaction early (e.g., at 90% instead of 100%)

        this.modelLimits = {
            contextWindow: effectiveContextWindow,
        };

        this.contextManager = new ContextManager<ModelMessage>(
            config,
            formatter,
            systemPromptManager,
            maxInputTokens,
            historyProvider,
            sessionId,
            resourceManager,
            this.logger
        );

        this.logger.debug(
            `[VercelLLMService] Initialized for model: ${this.getModelId()}, provider: ${this.config.provider}, temperature: ${this.config.temperature}, maxOutputTokens: ${this.config.maxOutputTokens}`
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.toolManager.getAllTools();
    }

    /**
     * Create a TurnExecutor instance for executing the agent loop.
     */
    private createTurnExecutor(externalSignal?: AbortSignal): TurnExecutor {
        return new TurnExecutor(
            this.model,
            this.toolManager,
            this.contextManager,
            this.sessionEventBus,
            this.resourceManager,
            this.sessionId,
            {
                maxSteps: this.config.maxIterations,
                maxOutputTokens: this.config.maxOutputTokens,
                temperature: this.config.temperature,
                baseURL: this.config.baseURL,
                // Provider-specific options
                reasoningEffort: this.config.reasoningEffort,
            },
            { provider: this.config.provider, model: this.getModelId() },
            this.logger,
            this.messageQueue,
            this.modelLimits,
            externalSignal,
            this.compactionStrategy,
            this.compactionThresholdPercent
        );
    }

    /**
     * Result from streaming a response.
     */
    public static StreamResult: { text: string };

    /**
     * Stream a response for the given content.
     * Primary method for running conversations with multi-image support.
     *
     * @param content - String or ContentPart[] (text, images, files)
     * @param options - { signal?: AbortSignal }
     * @returns Object with text response
     */
    async stream(
        content: ContentInput,
        options?: { signal?: AbortSignal }
    ): Promise<{ text: string }> {
        // Get active span and context for telemetry
        const activeSpan = trace.getActiveSpan();
        const currentContext = context.active();

        const provider = this.config.provider;
        const model = this.getModelId();

        // Set on active span
        if (activeSpan) {
            activeSpan.setAttribute('llm.provider', provider);
            activeSpan.setAttribute('llm.model', model);
        }

        // Add to baggage for child span propagation
        const existingBaggage = propagation.getBaggage(currentContext);
        const baggageEntries: Record<string, import('@opentelemetry/api').BaggageEntry> = {};

        // Preserve existing baggage
        if (existingBaggage) {
            existingBaggage.getAllEntries().forEach(([key, entry]) => {
                baggageEntries[key] = entry;
            });
        }

        // Add LLM metadata
        baggageEntries['llm.provider'] = { value: provider };
        baggageEntries['llm.model'] = { value: model };

        const updatedContext = propagation.setBaggage(
            currentContext,
            propagation.createBaggage(baggageEntries)
        );

        // Execute rest of method in updated context
        return await context.with(updatedContext, async () => {
            // Normalize content to ContentPart[] for addUserMessage
            const parts: ContentPart[] =
                typeof content === 'string' ? [{ type: 'text', text: content }] : content;

            // Add user message with all content parts
            await this.contextManager.addUserMessage(parts);

            // Create executor (uses session-level messageQueue, pass external abort signal)
            const executor = this.createTurnExecutor(options?.signal);

            // Execute with streaming enabled
            const contributorContext = { mcpManager: this.toolManager.getMcpManager() };
            const result = await executor.execute(contributorContext, true);

            return {
                text: result.text ?? '',
            };
        });
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.contextManager.getMaxInputTokens();
        let modelMaxInputTokens: number;

        // Fetching max tokens from LLM registry - default to configured max tokens if not found
        // Max tokens may not be found if the model is supplied by user
        try {
            modelMaxInputTokens = getMaxInputTokensForModel(
                this.config.provider,
                this.getModelId(),
                this.logger
            );
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                modelMaxInputTokens = configuredMaxTokens;
                this.logger.debug(
                    `Could not find model ${this.getModelId()} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxTokens}.`
                );
            } else {
                throw error;
            }
        }
        return {
            provider: this.config.provider,
            model: this.model,
            configuredMaxInputTokens: configuredMaxTokens,
            modelMaxInputTokens: modelMaxInputTokens,
        };
    }

    /**
     * Get the context manager for external access
     */
    getContextManager(): ContextManager<unknown> {
        return this.contextManager;
    }

    /**
     * Get the message queue for external access (e.g., queueing messages while busy)
     */
    getMessageQueue(): MessageQueueService {
        return this.messageQueue;
    }

    /**
     * Get the compaction strategy for external access (e.g., session-native compaction)
     */
    getCompactionStrategy():
        | import('../../context/compaction/types.js').ICompactionStrategy
        | null {
        return this.compactionStrategy;
    }
}
