import {
    LanguageModel,
    streamText,
    generateText,
    stepCountIs,
    ToolSet as VercelToolSet,
    jsonSchema,
    type ModelMessage,
    APICallError,
} from 'ai';
import { trace } from '@opentelemetry/api';
import { ContextManager } from '../../context/manager.js';
import type { TextPart, ImagePart, FilePart, UIResourcePart } from '../../context/types.js';
import { ToolManager } from '../../tools/tool-manager.js';
import { ToolSet } from '../../tools/types.js';
import { StreamProcessor } from './stream-processor.js';
import { ExecutorResult } from './types.js';
import { TokenUsage } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import { DynamicContributorContext } from '../../systemPrompt/types.js';
import { LLMContext, LLMRouter } from '../types.js';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { StreamProcessorConfig } from './stream-processor.js';
import type { CoalescedMessage } from '../../session/types.js';
import { defer } from '../../utils/defer.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';
import { toError } from '../../utils/error-conversion.js';
import { isOverflow, type ModelLimits } from '../../context/compression/overflow.js';
import { ReactiveOverflowStrategy } from '../../context/compression/reactive-overflow.js';

/**
 * Static cache for tool support validation.
 * Persists across TurnExecutor instances to avoid repeated validation calls.
 * Key format: "provider:model:baseURL"
 */
const toolSupportCache = new Map<string, boolean>();

/**
 * TurnExecutor orchestrates the agent loop using `stopWhen: stepCountIs(1)`.
 *
 * This is the main entry point that replaces Vercel's internal loop with our
 * controlled execution, giving us control between steps for:
 * - Message queue injection (Phase 6)
 * - Compression decisions (Phase 4)
 * - Pruning old tool outputs (Phase 5)
 *
 * Key design: Uses stopWhen: stepCountIs(1) to regain control after each step.
 * A "step" = ONE LLM call + ALL tool executions from that call.
 */
export class TurnExecutor {
    private logger: IDextoLogger;
    private abortController: AbortController;
    private compressionStrategy: ReactiveOverflowStrategy | null = null;

    constructor(
        private model: LanguageModel,
        private toolManager: ToolManager,
        private contextManager: ContextManager<ModelMessage>,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private sessionId: string,
        private config: {
            maxSteps: number;
            maxOutputTokens?: number | undefined;
            temperature?: number | undefined;
            baseURL?: string | undefined;
        },
        private llmContext: LLMContext,
        private router: LLMRouter,
        logger: IDextoLogger,
        private messageQueue: MessageQueueService,
        private modelLimits?: ModelLimits
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        this.abortController = new AbortController();

        // Initialize compression strategy if model limits are provided
        if (modelLimits) {
            this.compressionStrategy = new ReactiveOverflowStrategy(model, {}, this.logger);
        }
    }

    /**
     * Get StreamProcessor config from TurnExecutor state.
     */
    private getStreamProcessorConfig(): StreamProcessorConfig {
        return {
            provider: this.llmContext.provider,
            model: this.llmContext.model,
            router: this.router,
        };
    }

    /**
     * Main agent execution loop.
     * Uses stopWhen: stepCountIs(1) to regain control after each step.
     *
     * @param contributorContext Context for system prompt contributors
     * @param streaming If true, emits llm:chunk events during streaming. Default true.
     */
    async execute(
        contributorContext: DynamicContributorContext,
        streaming: boolean = true
    ): Promise<ExecutorResult> {
        // Automatic cleanup when scope exits (normal, throw, or return)
        using _ = defer(() => this.cleanup());

        let stepCount = 0;
        let lastStepTokens: TokenUsage | null = null;
        let lastFinishReason = 'unknown';
        let lastText = '';

        this.eventBus.emit('llm:thinking');

        // Check tool support once before the loop
        const supportsTools = await this.validateToolSupport();

        try {
            while (true) {
                // 1. Check for queued messages (mid-loop injection)
                const coalesced = this.messageQueue.dequeueAll();
                if (coalesced) {
                    await this.injectQueuedMessages(coalesced);
                }

                // 2. Check for compression need (reactive, based on actual tokens)
                if (lastStepTokens && this.checkAndHandleOverflow(lastStepTokens)) {
                    await this.compress(lastStepTokens.inputTokens ?? 0);
                    // Continue with fresh context after compression
                }

                // 3. Get formatted messages for this step
                const prepared = await this.contextManager.getFormattedMessagesWithCompression(
                    contributorContext,
                    this.llmContext
                );

                this.logger.debug(
                    `Step ${stepCount}: Starting with ${prepared.tokensUsed} estimated tokens`
                );

                // 4. Create tools with execute callbacks and toModelOutput
                // Use empty object if model doesn't support tools
                const tools = supportsTools ? await this.createTools() : {};

                // 5. Execute single step with stream processing
                const streamProcessor = new StreamProcessor(
                    this.contextManager,
                    this.eventBus,
                    this.resourceManager,
                    this.abortController.signal,
                    this.getStreamProcessorConfig(),
                    this.logger,
                    streaming
                );

                const result = await streamProcessor.process(() =>
                    streamText({
                        model: this.model,
                        stopWhen: stepCountIs(1),
                        tools,
                        abortSignal: this.abortController.signal,
                        messages: prepared.formattedMessages,
                        ...(this.config.maxOutputTokens !== undefined && {
                            maxOutputTokens: this.config.maxOutputTokens,
                        }),
                        ...(this.config.temperature !== undefined && {
                            temperature: this.config.temperature,
                        }),
                        // Log stream-level errors (tool errors, API errors during streaming)
                        onError: (error) => {
                            this.logger.error('Stream error', { error });
                        },
                    })
                );

                // 6. Capture results for tracking and overflow check
                lastStepTokens = result.usage;
                lastFinishReason = result.finishReason;
                lastText = result.text;

                this.logger.debug(
                    `Step ${stepCount}: Finished with reason="${result.finishReason}", ` +
                        `tokens=${JSON.stringify(result.usage)}`
                );

                // 7. Check termination conditions
                if (result.finishReason !== 'tool-calls') {
                    // Check queue before terminating - process queued messages if any
                    const queuedOnTerminate = this.messageQueue.dequeueAll();
                    if (queuedOnTerminate) {
                        this.logger.debug(
                            `Continuing: ${queuedOnTerminate.messages.length} queued message(s) to process`
                        );
                        await this.injectQueuedMessages(queuedOnTerminate);
                        continue; // Keep looping - process queued messages
                    }
                    this.logger.debug(`Terminating: finishReason is "${result.finishReason}"`);
                    break;
                }
                if (this.abortController.signal.aborted) {
                    this.logger.debug('Terminating: abort signal received');
                    break;
                }
                if (++stepCount >= this.config.maxSteps) {
                    this.logger.debug(`Terminating: reached maxSteps (${this.config.maxSteps})`);
                    break;
                }

                // 8. Prune old tool outputs (mark with compactedAt)
                await this.pruneOldToolOutputs();
            }
        } catch (error) {
            // Map provider errors to DextoRuntimeError
            const mappedError = this.mapProviderError(error);
            this.logger.error('TurnExecutor failed', { error: mappedError });

            this.eventBus.emit('llm:error', {
                error: mappedError,
                context: 'TurnExecutor',
                recoverable: false,
            });

            throw mappedError;
        }

        // Set telemetry attributes for token usage
        this.setTelemetryAttributes(lastStepTokens);

        return {
            text: lastText,
            stepCount,
            usage: lastStepTokens,
            finishReason: lastFinishReason,
        };
    }

    /**
     * Abort the current execution.
     */
    abort(): void {
        this.abortController.abort();
    }

    /**
     * Inject coalesced queued messages into the context as a single user message.
     * This enables "Claude Code-style" mid-task user guidance.
     */
    private async injectQueuedMessages(coalesced: CoalescedMessage): Promise<void> {
        // Add as single user message with all guidance
        await this.contextManager.addMessage({
            role: 'user',
            content: coalesced.combinedContent,
            metadata: {
                coalesced: coalesced.messages.length > 1,
                messageCount: coalesced.messages.length,
                originalMessageIds: coalesced.messages.map((m) => m.id),
            },
        });

        this.logger.info(`Injected ${coalesced.messages.length} queued message(s) into context`, {
            count: coalesced.messages.length,
            firstQueued: coalesced.firstQueuedAt,
            lastQueued: coalesced.lastQueuedAt,
        });
    }

    /**
     * Validates if the current model supports tools.
     * Uses a static cache to avoid repeated validation calls.
     *
     * For models using custom baseURL endpoints, makes a test call to verify tool support.
     * Built-in providers without baseURL are assumed to support tools.
     */
    private async validateToolSupport(): Promise<boolean> {
        const modelKey = `${this.llmContext.provider}:${this.llmContext.model}:${this.config.baseURL ?? ''}`;

        // Check cache first
        if (toolSupportCache.has(modelKey)) {
            return toolSupportCache.get(modelKey)!;
        }

        // Only test tool support for providers using custom baseURL endpoints
        // Built-in providers without baseURL have known tool support
        if (!this.config.baseURL) {
            this.logger.debug(`Skipping tool validation for ${modelKey} - no custom baseURL`);
            toolSupportCache.set(modelKey, true);
            return true;
        }

        this.logger.debug(`Testing tool support for custom endpoint model: ${modelKey}`);

        // Create a minimal test tool
        const testTool = {
            test_tool: {
                inputSchema: jsonSchema({
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                }),
                execute: async () => ({ result: 'test' }),
            },
        };

        try {
            // Make a minimal generateText call with tools to test support
            await generateText({
                model: this.model,
                messages: [{ role: 'user', content: 'Hello' }],
                tools: testTool,
                stopWhen: stepCountIs(1),
            });

            // If we get here, tools are supported
            toolSupportCache.set(modelKey, true);
            this.logger.debug(`Model ${modelKey} supports tools`);
            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('does not support tools')) {
                toolSupportCache.set(modelKey, false);
                this.logger.debug(`Model ${modelKey} does not support tools`);
                return false;
            }
            // Other errors - assume tools are supported and let the actual call handle it
            this.logger.debug(
                `Tool validation error for ${modelKey}, assuming supported: ${errorMessage}`
            );
            toolSupportCache.set(modelKey, true);
            return true;
        }
    }

    /**
     * Creates tools with execute callbacks and toModelOutput.
     *
     * Key design decisions:
     * - execute() returns raw result with inline images (async)
     * - toModelOutput() formats for LLM consumption (sync)
     * - StreamProcessor handles persistence via tool-result events
     */
    private async createTools(): Promise<VercelToolSet> {
        const tools: ToolSet = await this.toolManager.getAllTools();

        return Object.fromEntries(
            Object.entries(tools).map(([name, tool]) => [
                name,
                {
                    inputSchema: jsonSchema(tool.parameters),
                    ...(tool.description && { description: tool.description }),

                    /**
                     * Execute callback - runs the tool and returns raw result.
                     * Does NOT persist - StreamProcessor handles that on tool-result event.
                     */
                    execute: async (
                        args: unknown,
                        _options: { toolCallId: string }
                    ): Promise<unknown> => {
                        this.logger.debug(`Executing tool: ${name}`);

                        // Run tool via toolManager - returns raw result with inline images
                        const rawResult = await this.toolManager.executeTool(
                            name,
                            args as Record<string, unknown>,
                            this.sessionId
                        );

                        return rawResult;
                    },

                    /**
                     * toModelOutput - formats raw result for LLM consumption.
                     * Called by Vercel SDK when preparing messages for next LLM call.
                     * SYNC - images are already inline in the raw result.
                     */
                    toModelOutput: (result: unknown) => {
                        return this.formatToolResultForLLM(result, name);
                    },
                },
            ])
        );
    }

    /**
     * Format tool result for LLM consumption.
     * Handles multimodal content (text + images).
     *
     * This handles RAW tool results - the structure may vary.
     */
    private formatToolResultForLLM(
        result: unknown,
        toolName: string
    ):
        | { type: 'text'; value: string }
        | {
              type: 'content';
              value: Array<
                  | { type: 'text'; text: string }
                  | { type: 'media'; data: string; mediaType: string }
              >;
          } {
        // Handle error results
        if (result && typeof result === 'object' && 'error' in result) {
            const errorResult = result as { error: string; denied?: boolean; timeout?: boolean };
            let errorFlags = '';
            if (errorResult.denied) errorFlags += ' (denied)';
            if (errorResult.timeout) errorFlags += ' (timeout)';
            return {
                type: 'text',
                value: `Tool ${toolName} failed${errorFlags}: ${errorResult.error}`,
            };
        }

        // Handle multimodal results with content array
        if (this.hasMultimodalContent(result)) {
            const contentArray = (
                result as { content: Array<{ type: string; [key: string]: unknown }> }
            ).content;
            const contentValue: Array<
                { type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }
            > = [];

            for (const part of contentArray) {
                if (part.type === 'text' && typeof part.text === 'string') {
                    contentValue.push({ type: 'text', text: part.text });
                } else if (part.type === 'image') {
                    // Handle various image formats - check both 'image' and 'data' fields
                    const imageData = this.extractImageData(part);
                    if (imageData) {
                        contentValue.push({
                            type: 'media',
                            data: imageData,
                            mediaType: (part.mimeType as string) || 'image/jpeg',
                        });
                    }
                } else if (part.type === 'file') {
                    const fileData = this.extractFileData(part);
                    if (fileData) {
                        contentValue.push({
                            type: 'media',
                            data: fileData,
                            mediaType: (part.mimeType as string) || 'application/octet-stream',
                        });
                    }
                }
            }

            // If we have multimodal content (media), return it
            if (contentValue.length > 0 && contentValue.some((v) => v.type === 'media')) {
                return { type: 'content', value: contentValue };
            }

            // Text-only content array - concatenate text parts
            const textParts = contentArray
                .filter((p) => p.type === 'text' && typeof p.text === 'string')
                .map((p) => p.text as string);
            return {
                type: 'text',
                value: textParts.join('\n') || '[empty result]',
            };
        }

        // Fallback: convert to string
        if (typeof result === 'string') {
            return { type: 'text', value: result };
        }

        return {
            type: 'text',
            value:
                typeof result === 'object' && result !== null
                    ? JSON.stringify(result)
                    : String(result),
        };
    }

    /**
     * Extract image data from a part, handling various formats.
     */
    private extractImageData(part: { [key: string]: unknown }): string | null {
        // Try 'image' field first (our standard ImagePart format)
        if (typeof part.image === 'string') {
            return part.image;
        }
        // Try 'data' field (alternative format)
        if (typeof part.data === 'string') {
            return part.data;
        }
        // Handle Buffer/ArrayBuffer
        if (part.image instanceof Buffer) {
            return part.image.toString('base64');
        }
        if (part.data instanceof Buffer) {
            return (part.data as Buffer).toString('base64');
        }
        if (part.image instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.image)).toString('base64');
        }
        if (part.data instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.data as ArrayBuffer)).toString('base64');
        }
        return null;
    }

    /**
     * Extract file data from a part.
     */
    private extractFileData(part: { [key: string]: unknown }): string | null {
        if (typeof part.data === 'string') {
            return part.data;
        }
        if (part.data instanceof Buffer) {
            return (part.data as Buffer).toString('base64');
        }
        if (part.data instanceof ArrayBuffer) {
            return Buffer.from(new Uint8Array(part.data as ArrayBuffer)).toString('base64');
        }
        return null;
    }

    /**
     * Check if result has multimodal content array
     */
    private hasMultimodalContent(result: unknown): boolean {
        return (
            result !== null &&
            typeof result === 'object' &&
            'content' in result &&
            Array.isArray((result as { content: unknown }).content)
        );
    }

    // TODO Phase 4: Implement overflow detection
    // private isOverflow(tokens: TokenUsage): boolean {
    //     const contextLimit = this.modelLimits.contextWindow;
    //     const outputBuffer = Math.min(this.modelLimits.maxOutput, OUTPUT_TOKEN_MAX);
    //     const usable = contextLimit - outputBuffer;
    //     const used = tokens.inputTokens + (tokens.cacheReadTokens ?? 0);
    //     return used > usable;
    // }

    // TODO Phase 4: Implement compression
    // private async compress(): Promise<void> {
    //     // Use compression strategy to compress history
    // }

    /**
     * Constants for pruning thresholds
     */
    private static readonly PRUNE_PROTECT = 40_000; // Keep last 40K tokens of tool outputs
    private static readonly PRUNE_MINIMUM = 20_000; // Only prune if we can save 20K+

    /**
     * Prunes old tool outputs by marking them with compactedAt timestamp.
     * Does NOT modify content - transformation happens at format time in
     * ContextManager.getFormattedMessagesWithCompression().
     *
     * Algorithm:
     * 1. Go backwards through history (most recent first)
     * 2. Stop at summary message (only process post-summary messages)
     * 3. Count tool message tokens
     * 4. If total exceeds PRUNE_PROTECT, mark older ones for pruning
     * 5. Only prune if savings exceed PRUNE_MINIMUM
     */
    private async pruneOldToolOutputs(): Promise<{ prunedCount: number; savedTokens: number }> {
        const history = await this.contextManager.getHistory();
        let totalToolTokens = 0;
        let prunedTokens = 0;
        const toPrune: string[] = []; // Message IDs to mark

        // Go backwards through history (most recent first)
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (!msg) continue;

            // Stop at summary message - only prune AFTER the summary
            if (msg.metadata?.isSummary === true) break;

            // Only process tool messages
            if (msg.role !== 'tool') continue;

            // Skip already pruned messages
            if (msg.compactedAt) continue;

            // Tool message content is always an array after sanitization
            if (!Array.isArray(msg.content)) continue;

            const tokens = this.estimateToolTokens(msg.content);
            totalToolTokens += tokens;

            // If we've exceeded protection threshold, mark for pruning
            if (totalToolTokens > TurnExecutor.PRUNE_PROTECT && msg.id) {
                prunedTokens += tokens;
                toPrune.push(msg.id);
            }
        }

        // Only prune if significant savings
        if (prunedTokens > TurnExecutor.PRUNE_MINIMUM && toPrune.length > 0) {
            const markedCount = await this.contextManager.markMessagesAsCompacted(toPrune);

            this.eventBus.emit('context:pruned', {
                prunedCount: markedCount,
                savedTokens: prunedTokens,
            });

            this.logger.debug(`Pruned ${markedCount} tool outputs, saving ~${prunedTokens} tokens`);

            return { prunedCount: markedCount, savedTokens: prunedTokens };
        }

        return { prunedCount: 0, savedTokens: 0 };
    }

    /**
     * Estimates tokens for tool message content using simple heuristic (length/4).
     * Used for pruning decisions only - actual token counts come from API.
     *
     * Tool message content is always Array<TextPart | ImagePart | FilePart | UIResourcePart>
     * after sanitization via SanitizedToolResult.
     */
    private estimateToolTokens(
        content: Array<TextPart | ImagePart | FilePart | UIResourcePart>
    ): number {
        return content.reduce((sum, part) => {
            if (part.type === 'text') {
                return sum + Math.ceil(part.text.length / 4);
            }
            // Images/files contribute ~1000 tokens estimate
            if (part.type === 'image' || part.type === 'file') {
                return sum + 1000;
            }
            // UIResourcePart - minimal token contribution
            return sum;
        }, 0);
    }

    /**
     * Cleanup resources when execution scope exits.
     * Called automatically via defer() on normal exit, throw, or abort.
     */
    private cleanup(): void {
        this.logger.debug('TurnExecutor cleanup triggered');

        // Abort any pending operations
        if (!this.abortController.signal.aborted) {
            this.abortController.abort();
        }

        // Clear any pending queued messages
        this.messageQueue.clear();
    }

    /**
     * Check if context has overflowed based on actual token usage from API.
     */
    private checkAndHandleOverflow(tokens: TokenUsage): boolean {
        if (!this.modelLimits || !this.compressionStrategy) {
            return false;
        }
        return isOverflow(tokens, this.modelLimits);
    }

    /**
     * Compress context using ReactiveOverflowStrategy.
     *
     * Generates a summary of older messages and adds it to history.
     * The actual token reduction happens at read-time via filterCompacted()
     * in getFormattedMessagesWithCompression().
     *
     * @param originalTokens The actual input token count from API that triggered overflow
     */
    private async compress(originalTokens: number): Promise<void> {
        if (!this.compressionStrategy) {
            return;
        }

        this.logger.info(
            `Context overflow detected (${originalTokens} tokens), running compression`
        );

        const history = await this.contextManager.getHistory();
        const tokenizer = this.contextManager.getTokenizer();
        const maxTokens = this.modelLimits?.contextWindow ?? 100000;

        // Generate summary message(s)
        const summaryMessages = await this.compressionStrategy.compress(
            history,
            tokenizer,
            maxTokens
        );

        if (summaryMessages.length === 0) {
            this.logger.debug('Compression returned no summary (history too short)');
            return;
        }

        // Add summary to history
        // filterCompacted() will exclude pre-summary messages at read-time
        for (const summary of summaryMessages) {
            await this.contextManager.addMessage(summary);
        }

        // Estimate compressed tokens by simulating what filterCompacted would produce
        const { filterCompacted, countMessagesTokens } = await import('../../context/utils.js');
        const updatedHistory = await this.contextManager.getHistory();
        const filteredHistory = filterCompacted(updatedHistory);
        const compressedTokens = countMessagesTokens(filteredHistory, tokenizer, 4, this.logger);

        this.eventBus.emit('context:compressed', {
            originalTokens,
            compressedTokens,
            originalMessages: history.length,
            compressedMessages: filteredHistory.length,
            strategy: this.compressionStrategy.name,
            reason: 'overflow',
        });

        this.logger.info(
            `Compression complete: ${originalTokens} → ~${compressedTokens} tokens ` +
                `(${history.length} → ${filteredHistory.length} messages after filtering)`
        );
    }

    /**
     * Set telemetry span attributes for token usage.
     */
    private setTelemetryAttributes(usage: TokenUsage | null): void {
        const activeSpan = trace.getActiveSpan();
        if (!activeSpan || !usage) {
            return;
        }

        if (usage.inputTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens);
        }
        if (usage.outputTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens);
        }
        if (usage.totalTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.total_tokens', usage.totalTokens);
        }
        if (usage.reasoningTokens !== undefined) {
            activeSpan.setAttribute('gen_ai.usage.reasoning_tokens', usage.reasoningTokens);
        }
    }

    /**
     * Map provider errors to DextoRuntimeError.
     */
    private mapProviderError(err: unknown): Error {
        if (APICallError.isInstance?.(err)) {
            const status = err.statusCode;
            const headers = (err.responseHeaders || {}) as Record<string, string>;
            const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : undefined;
            const body =
                typeof err.responseBody === 'string'
                    ? err.responseBody
                    : JSON.stringify(err.responseBody ?? '');

            if (status === 429) {
                return new DextoRuntimeError(
                    LLMErrorCode.RATE_LIMIT_EXCEEDED,
                    ErrorScope.LLM,
                    ErrorType.RATE_LIMIT,
                    `Rate limit exceeded${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        retryAfter,
                        body,
                    }
                );
            }
            if (status === 408) {
                return new DextoRuntimeError(
                    LLMErrorCode.GENERATION_FAILED,
                    ErrorScope.LLM,
                    ErrorType.TIMEOUT,
                    `Provider timed out${body ? ` - ${body}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        body,
                    }
                );
            }
            return new DextoRuntimeError(
                LLMErrorCode.GENERATION_FAILED,
                ErrorScope.LLM,
                ErrorType.THIRD_PARTY,
                `Provider error ${status}${body ? ` - ${body}` : ''}`,
                {
                    sessionId: this.sessionId,
                    provider: this.llmContext.provider,
                    model: this.llmContext.model,
                    status,
                    body,
                }
            );
        }

        return toError(err, this.logger);
    }
}
