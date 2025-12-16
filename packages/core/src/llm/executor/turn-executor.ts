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
import type { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import { DynamicContributorContext } from '../../systemPrompt/types.js';
import { LLMContext } from '../types.js';
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
    /**
     * Per-step abort controller. Created fresh for each iteration of the loop.
     * This allows soft cancel (abort current step) while still continuing with queued messages.
     */
    private stepAbortController: AbortController;
    // TODO: improve compression configurability
    private compressionStrategy: ReactiveOverflowStrategy | null = null;
    /**
     * Map to track approval metadata by toolCallId.
     * Used to pass approval info from tool execution to result persistence.
     */
    private approvalMetadata = new Map<
        string,
        { requireApproval: boolean; approvalStatus?: 'approved' | 'rejected' }
    >();

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
        logger: IDextoLogger,
        private messageQueue: MessageQueueService,
        private modelLimits?: ModelLimits,
        private externalSignal?: AbortSignal
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        // Initial controller - will be replaced per-step in execute()
        this.stepAbortController = new AbortController();

        // NOTE: We intentionally do NOT link external signal here permanently.
        // Instead, we link it per-step in execute() so that:
        // - Soft cancel: aborts current step, but queue can continue with fresh controller
        // - Hard cancel (external aborted + clearQueue): checked explicitly in loop

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

        // Track run duration
        const startTime = Date.now();

        let stepCount = 0;
        let lastStepTokens: TokenUsage | null = null;
        let lastFinishReason: LLMFinishReason = 'unknown';
        let lastText = '';

        this.eventBus.emit('llm:thinking');

        // Check tool support once before the loop
        const supportsTools = await this.validateToolSupport();

        // Track current abort handler to remove between iterations (prevents listener accumulation)
        let currentAbortHandler: (() => void) | null = null;

        try {
            while (true) {
                // 0. Clean up previous iteration's abort handler (if any)
                if (currentAbortHandler && this.externalSignal) {
                    this.externalSignal.removeEventListener('abort', currentAbortHandler);
                }

                // Create fresh abort controller for this step
                // This allows soft cancel (abort current step) while continuing with queued messages
                this.stepAbortController = new AbortController();

                // Link external signal to this step only (if not already aborted for hard cancel)
                currentAbortHandler = () => this.stepAbortController.abort();
                if (this.externalSignal && !this.externalSignal.aborted) {
                    this.externalSignal.addEventListener('abort', currentAbortHandler, {
                        once: true,
                    });
                }

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

                this.logger.debug(`Step ${stepCount}: Starting`);

                // 4. Create tools with execute callbacks and toModelOutput
                // Use empty object if model doesn't support tools
                const tools = supportsTools ? await this.createTools() : {};

                // 5. Execute single step with stream processing
                const streamProcessor = new StreamProcessor(
                    this.contextManager,
                    this.eventBus,
                    this.resourceManager,
                    this.stepAbortController.signal,
                    this.getStreamProcessorConfig(),
                    this.logger,
                    streaming,
                    this.approvalMetadata
                );

                const result = await streamProcessor.process(() =>
                    streamText({
                        model: this.model,
                        stopWhen: stepCountIs(1),
                        tools,
                        abortSignal: this.stepAbortController.signal,
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
                    // Note: Hard cancel clears the queue BEFORE aborting, so if messages exist
                    // here it means soft cancel - we should continue processing them
                    const queuedOnTerminate = this.messageQueue.dequeueAll();
                    if (queuedOnTerminate) {
                        this.logger.debug(
                            `Continuing: ${queuedOnTerminate.messages.length} queued message(s) to process`
                        );
                        await this.injectQueuedMessages(queuedOnTerminate);
                        continue; // Keep looping with fresh controller - process queued messages
                    }
                    this.logger.debug(`Terminating: finishReason is "${result.finishReason}"`);
                    break;
                }
                // Hard cancel check during tool-calls - if queue is empty and signal aborted, exit
                if (this.externalSignal?.aborted && !this.messageQueue.hasPending()) {
                    this.logger.debug('Terminating: hard cancel - external abort signal received');
                    lastFinishReason = 'cancelled';
                    break;
                }
                if (++stepCount >= this.config.maxSteps) {
                    this.logger.debug(`Terminating: reached maxSteps (${this.config.maxSteps})`);
                    lastFinishReason = 'max-steps';
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

            // Flush any pending history updates before completing
            await this.contextManager.flush();

            // Emit run:complete with error before throwing
            this.eventBus.emit('run:complete', {
                finishReason: 'error',
                stepCount,
                durationMs: Date.now() - startTime,
                error: mappedError,
            });

            throw mappedError;
        }

        // Flush any pending history updates to ensure durability
        await this.contextManager.flush();

        // Set telemetry attributes for token usage
        this.setTelemetryAttributes(lastStepTokens);

        // Emit run:complete event - the entire run is now finished
        this.eventBus.emit('run:complete', {
            finishReason: lastFinishReason,
            stepCount,
            durationMs: Date.now() - startTime,
        });

        return {
            text: lastText,
            stepCount,
            usage: lastStepTokens,
            finishReason: lastFinishReason,
        };
    }

    /**
     * Abort the current step execution.
     * Note: For full run cancellation, use the external abort signal.
     */
    abort(): void {
        this.stepAbortController.abort();
    }

    /**
     * Inject coalesced queued messages into the context as a single user message.
     * This enables mid-task user guidance.
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

        // Add timeout protection to fail fast if endpoint is unresponsive
        const testAbort = new AbortController();
        const testTimeout = setTimeout(() => testAbort.abort(), 5000); // 5s timeout

        try {
            // Make a minimal generateText call with tools to test support
            await generateText({
                model: this.model,
                messages: [{ role: 'user', content: 'Hello' }],
                tools: testTool,
                stopWhen: stepCountIs(1),
                abortSignal: testAbort.signal,
            });
            clearTimeout(testTimeout);

            // If we get here, tools are supported
            toolSupportCache.set(modelKey, true);
            this.logger.debug(`Model ${modelKey} supports tools`);
            return true;
        } catch (error: unknown) {
            clearTimeout(testTimeout);
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('does not support tools')) {
                toolSupportCache.set(modelKey, false);
                this.logger.debug(`Model ${modelKey} does not support tools`);
                return false;
            }
            // Other errors (including timeout) - assume tools are supported and let the actual call handle it
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
                        options: { toolCallId: string }
                    ): Promise<unknown> => {
                        this.logger.debug(
                            `Executing tool: ${name} (toolCallId: ${options.toolCallId})`
                        );

                        // Run tool via toolManager - returns result with approval metadata
                        // toolCallId is passed for tracking parallel tool calls in the UI
                        const executionResult = await this.toolManager.executeTool(
                            name,
                            args as Record<string, unknown>,
                            options.toolCallId,
                            this.sessionId
                        );

                        // Store approval metadata for later retrieval by StreamProcessor
                        if (executionResult.requireApproval !== undefined) {
                            const metadata: {
                                requireApproval: boolean;
                                approvalStatus?: 'approved' | 'rejected';
                            } = {
                                requireApproval: executionResult.requireApproval,
                            };
                            if (executionResult.approvalStatus !== undefined) {
                                metadata.approvalStatus = executionResult.approvalStatus;
                            }
                            this.approvalMetadata.set(options.toolCallId, metadata);
                        }

                        // Return just the raw result for Vercel SDK
                        return executionResult.result;
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

        // Abort any pending operations for current step
        if (!this.stepAbortController.signal.aborted) {
            this.stepAbortController.abort();
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

        // Generate summary message(s)
        const summaryMessages = await this.compressionStrategy.compress(history);

        if (summaryMessages.length === 0) {
            this.logger.debug('Compression returned no summary (history too short)');
            return;
        }

        // Add summary to history
        // filterCompacted() will exclude pre-summary messages at read-time
        for (const summary of summaryMessages) {
            await this.contextManager.addMessage(summary);
        }

        // Get filtered history to report message counts
        const { filterCompacted, estimateMessagesTokens } = await import('../../context/utils.js');
        const updatedHistory = await this.contextManager.getHistory();
        const filteredHistory = filterCompacted(updatedHistory);
        const compressedTokens = estimateMessagesTokens(filteredHistory);

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
