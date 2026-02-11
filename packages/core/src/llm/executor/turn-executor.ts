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
import { buildProviderOptions } from './provider-options.js';
import { TokenUsage } from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import type { ResourceManager } from '../../resources/index.js';
import { DynamicContributorContext } from '../../systemPrompt/types.js';
import { LLMContext, type LLMProvider } from '../types.js';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { StreamProcessorConfig } from './stream-processor.js';
import type { CoalescedMessage } from '../../session/types.js';
import { defer } from '../../utils/defer.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';
import { toError } from '../../utils/error-conversion.js';
import type { ICompactionStrategy } from '../../context/compaction/types.js';
import type { ModelLimits } from '../../context/compaction/overflow.js';

/**
 * Static cache for tool support validation.
 * Persists across TurnExecutor instances to avoid repeated validation calls.
 * Key format: "provider:model:baseURL"
 */
const toolSupportCache = new Map<string, boolean>();

/**
 * Local providers that need tool support validation regardless of baseURL
 */
const LOCAL_PROVIDERS: readonly LLMProvider[] = ['ollama', 'local'] as const;

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
    private compactionStrategy: ICompactionStrategy | null = null;
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
            maxSteps?: number | undefined;
            maxOutputTokens?: number | undefined;
            temperature?: number | undefined;
            baseURL?: string | undefined;
            // Provider-specific options
            reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
        },
        private llmContext: LLMContext,
        logger: IDextoLogger,
        private messageQueue: MessageQueueService,
        private modelLimits?: ModelLimits,
        private externalSignal?: AbortSignal,
        compactionStrategy: ICompactionStrategy | null = null
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        // Initial controller - will be replaced per-step in execute()
        this.stepAbortController = new AbortController();

        // NOTE: We intentionally do NOT link external signal here permanently.
        // Instead, we link it per-step in execute() so that:
        // - Soft cancel: aborts current step, but queue can continue with fresh controller
        // - Hard cancel (external aborted + clearQueue): checked explicitly in loop

        this.compactionStrategy = compactionStrategy;
    }

    /**
     * Get StreamProcessor config from TurnExecutor state.
     * @param estimatedInputTokens Optional estimated input tokens for analytics
     */
    private getStreamProcessorConfig(estimatedInputTokens?: number): StreamProcessorConfig {
        return {
            provider: this.llmContext.provider,
            model: this.llmContext.model,
            ...(estimatedInputTokens !== undefined && { estimatedInputTokens }),
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

        // Emit warning if tools are not supported
        if (!supportsTools) {
            const modelKey = `${this.llmContext.provider}:${this.llmContext.model}`;
            this.eventBus.emit('llm:unsupported-input', {
                errors: [
                    `Model '${modelKey}' does not support tool calling.`,
                    'You can still chat, but the model will not be able to use tools or execute commands.',
                ],
                provider: this.llmContext.provider,
                model: this.llmContext.model,
                details: {
                    feature: 'tool-calling',
                    supported: false,
                },
            });
            this.logger.warn(
                `Model ${modelKey} does not support tools - continuing without tool calling`
            );
        }

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

                // 2. Prune old tool outputs BEFORE checking compaction
                // This gives pruning a chance to free up space and potentially avoid compaction
                await this.pruneOldToolOutputs();

                // 3. Get formatted messages for this step
                let prepared = await this.contextManager.getFormattedMessagesForLLM(
                    contributorContext,
                    this.llmContext
                );

                // 4. PRE-CHECK: Estimate tokens and compact if over threshold BEFORE LLM call
                // This ensures we never make an oversized call and avoids unnecessary compaction on stop steps
                // Uses the same formula as /context overlay: lastInput + lastOutput + newMessagesEstimate
                const toolDefinitions = supportsTools
                    ? this.toolManager.filterToolsForSession(
                          await this.toolManager.getAllTools(),
                          this.sessionId
                      )
                    : {};
                let estimatedTokens = await this.contextManager.getEstimatedNextInputTokens(
                    prepared.systemPrompt,
                    prepared.preparedHistory,
                    toolDefinitions
                );
                if (this.shouldCompact(estimatedTokens)) {
                    this.logger.debug(
                        `Pre-check: estimated ${estimatedTokens} tokens exceeds threshold, compacting`
                    );
                    const didCompact = await this.compactContext(
                        estimatedTokens,
                        contributorContext,
                        toolDefinitions
                    );

                    // If compaction occurred, rebuild messages (filterCompacted will handle it)
                    if (didCompact) {
                        prepared = await this.contextManager.getFormattedMessagesForLLM(
                            contributorContext,
                            this.llmContext
                        );
                        // Recompute token estimate after compaction for accurate analytics/metrics
                        estimatedTokens = await this.contextManager.getEstimatedNextInputTokens(
                            prepared.systemPrompt,
                            prepared.preparedHistory,
                            toolDefinitions
                        );
                        this.logger.debug(
                            `Post-compaction: recomputed estimate is ${estimatedTokens} tokens`
                        );
                    }
                }

                this.logger.debug(`Step ${stepCount}: Starting`);

                // 5. Create tools with execute callbacks and toModelOutput
                // Use empty object if model doesn't support tools
                const tools = supportsTools ? await this.createTools() : {};

                // 6. Execute single step with stream processing
                const streamProcessor = new StreamProcessor(
                    this.contextManager,
                    this.eventBus,
                    this.resourceManager,
                    this.stepAbortController.signal,
                    this.getStreamProcessorConfig(estimatedTokens),
                    this.logger,
                    streaming,
                    this.approvalMetadata
                );

                // Build provider-specific options (caching, reasoning, etc.)
                const providerOptions = buildProviderOptions({
                    provider: this.llmContext.provider,
                    model: this.llmContext.model,
                    reasoningEffort: this.config.reasoningEffort,
                });

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
                        // Provider-specific options (caching, reasoning, etc.)
                        ...(providerOptions !== undefined && {
                            providerOptions:
                                providerOptions as import('@ai-sdk/provider').SharedV2ProviderOptions,
                        }),
                        // Log stream-level errors (tool errors, API errors during streaming)
                        onError: (error) => {
                            this.logger.error('Stream error', { error });
                        },
                    })
                );

                // 7. Capture results for tracking and overflow check
                lastStepTokens = result.usage;
                lastFinishReason = result.finishReason;
                lastText = result.text;

                this.logger.debug(
                    `Step ${stepCount}: Finished with reason="${result.finishReason}", ` +
                        `tokens=${JSON.stringify(result.usage)}`
                );

                // 7a. Store actual token counts for context estimation formula
                // Formula: estimatedNextInput = lastInput + lastOutput + newMessagesEstimate
                //
                // Strategy: Only update tracking variables on successful calls with actual token data.
                // - lastInput/lastOutput: ground truth from API, used as base for next estimate
                // - lastCallMessageCount: boundary for identifying "new" messages to estimate
                //
                // On cancellation: Don't update anything. The partial response is saved to history,
                // and newMessagesEstimate will include it when calculating from the last successful
                // call's boundary. This minimizes estimation surface - we only estimate the delta
                // since the last call that gave us actual token counts. Multiple consecutive
                // cancellations accumulate in newMessagesEstimate until a successful call self-corrects.
                //
                // Tracking issue for AI SDK to support partial usage on cancel:
                // https://github.com/vercel/ai/issues/7628
                if (result.finishReason === 'cancelled') {
                    // On cancellation, don't update any tracking variables.
                    // The partial response is saved to history, and newMessagesEstimate will
                    // include it when calculating from the last successful call's boundary.
                    // This keeps estimation surface minimal - we only estimate the delta since
                    // the last call that gave us actual token counts.
                    this.logger.info(
                        `Context estimation (cancelled): keeping last known actuals, partial response (${result.text.length} chars) will be estimated`
                    );
                } else if (result.usage?.inputTokens !== undefined) {
                    const contextInputTokens = this.getContextInputTokens(result.usage);
                    const actualInputTokens = contextInputTokens ?? result.usage.inputTokens;

                    // Log verification metric: compare our estimate vs actual from API
                    const diff = estimatedTokens - actualInputTokens;
                    const diffPercent =
                        actualInputTokens > 0
                            ? ((diff / actualInputTokens) * 100).toFixed(1)
                            : '0.0';
                    this.logger.info(
                        `Context estimation accuracy: estimated=${estimatedTokens}, actual=${actualInputTokens}, ` +
                            `error=${diff} (${diffPercent}%)`
                    );
                    this.contextManager.setLastActualInputTokens(actualInputTokens);

                    if (result.usage?.outputTokens !== undefined) {
                        this.contextManager.setLastActualOutputTokens(result.usage.outputTokens);
                    }

                    // Record message count boundary for identifying "new" messages
                    // Only update on successful calls - cancelled calls leave boundary unchanged
                    // so their content is included in newMessagesEstimate
                    await this.contextManager.recordLastCallMessageCount();
                }

                // 7b. POST-RESPONSE CHECK: Use actual inputTokens from API to detect overflow
                // This catches cases where the LLM's response pushed us over the threshold
                const contextInputTokens = result.usage
                    ? this.getContextInputTokens(result.usage)
                    : null;
                if (contextInputTokens && this.shouldCompactFromActual(contextInputTokens)) {
                    this.logger.debug(
                        `Post-response: actual ${contextInputTokens} tokens exceeds threshold, compacting`
                    );
                    await this.compactContext(
                        contextInputTokens,
                        contributorContext,
                        toolDefinitions
                    );
                }

                // 8. Check termination conditions
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
                stepCount++;
                if (this.config.maxSteps !== undefined && stepCount >= this.config.maxSteps) {
                    this.logger.debug(`Terminating: reached maxSteps (${this.config.maxSteps})`);
                    lastFinishReason = 'max-steps';
                    break;
                }
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
     * For local providers (Ollama, local) and custom baseURL endpoints, makes a test call to verify tool support.
     * Known cloud providers without baseURL are assumed to support tools.
     */
    private async validateToolSupport(): Promise<boolean> {
        const modelKey = `${this.llmContext.provider}:${this.llmContext.model}:${this.config.baseURL ?? ''}`;

        // Check cache first
        if (toolSupportCache.has(modelKey)) {
            return toolSupportCache.get(modelKey)!;
        }

        // Local providers need validation regardless of baseURL (models have varying support)
        const isLocalProvider = LOCAL_PROVIDERS.includes(this.llmContext.provider);

        // Skip validation only for known cloud providers without custom baseURL
        if (!this.config.baseURL && !isLocalProvider) {
            this.logger.debug(
                `Skipping tool validation for ${modelKey} - known cloud provider without custom baseURL`
            );
            toolSupportCache.set(modelKey, true);
            return true;
        }

        this.logger.debug(
            `Testing tool support for ${isLocalProvider ? 'local provider' : 'custom endpoint'} model: ${modelKey}`
        );

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
                this.logger.debug(
                    `Detected that model ${modelKey} does not support tool calling - tool functionality will be disabled`
                );
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
        const tools: ToolSet = this.toolManager.filterToolsForSession(
            await this.toolManager.getAllTools(),
            this.sessionId
        );

        return Object.fromEntries(
            Object.entries(tools).map(([name, tool]) => [
                name,
                {
                    inputSchema: jsonSchema(tool.parameters),
                    ...(tool.description && { description: tool.description }),

                    /**
                     * Execute callback - runs the tool and returns raw result.
                     * Does NOT persist - StreamProcessor handles that on tool-result event.
                     *
                     * Uses Promise.race to ensure we return quickly on abort, even if the
                     * underlying tool (especially MCP tools we don't control) keeps running.
                     */
                    execute: async (
                        args: unknown,
                        options: { toolCallId: string }
                    ): Promise<unknown> => {
                        this.logger.debug(
                            `Executing tool: ${name} (toolCallId: ${options.toolCallId})`
                        );

                        const abortSignal = this.stepAbortController.signal;

                        // Check if already aborted before starting
                        if (abortSignal.aborted) {
                            this.logger.debug(`Tool ${name} cancelled before execution`);
                            return { error: 'Cancelled by user', cancelled: true };
                        }

                        // Create abort handler for cleanup
                        let abortHandler: (() => void) | null = null;

                        // Create abort promise for Promise.race
                        // This ensures we return quickly even if tool doesn't respect abort signal
                        const abortPromise = new Promise<{ error: string; cancelled: true }>(
                            (resolve) => {
                                abortHandler = () => {
                                    this.logger.debug(`Tool ${name} cancelled during execution`);
                                    resolve({ error: 'Cancelled by user', cancelled: true });
                                };
                                abortSignal.addEventListener('abort', abortHandler, { once: true });
                            }
                        );

                        // Race: tool execution vs abort signal
                        try {
                            const result = await Promise.race([
                                (async () => {
                                    // Run tool via toolManager - returns result with approval metadata
                                    // toolCallId is passed for tracking parallel tool calls in the UI
                                    // Pass abortSignal so tools can do proper cleanup (e.g., kill processes)
                                    const executionResult = await this.toolManager.executeTool(
                                        name,
                                        args as Record<string, unknown>,
                                        options.toolCallId,
                                        this.sessionId,
                                        abortSignal
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
                                            metadata.approvalStatus =
                                                executionResult.approvalStatus;
                                        }
                                        this.approvalMetadata.set(options.toolCallId, metadata);
                                    }

                                    // Return just the raw result for Vercel SDK
                                    return executionResult.result;
                                })(),
                                abortPromise,
                            ]);

                            return result;
                        } finally {
                            // Clean up abort listener to prevent memory leak
                            if (abortHandler) {
                                abortSignal.removeEventListener('abort', abortHandler);
                            }
                        }
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
     * ContextManager.prepareHistory().
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
     * Check if context should be compacted based on estimated token count.
     * Uses the threshold percentage from compaction config to trigger earlier (e.g., at 90%).
     *
     * @param estimatedTokens Estimated token count from the current context
     * @returns true if compaction is needed before making the LLM call
     */
    private shouldCompact(estimatedTokens: number): boolean {
        if (!this.modelLimits || !this.compactionStrategy) {
            return false;
        }
        return this.compactionStrategy.shouldCompact(estimatedTokens, this.modelLimits);
    }

    /**
     * Check if context should be compacted based on actual token count from API response.
     * This is a post-response check using real token counts rather than estimates.
     *
     * @param actualTokens Actual input token count from the API response
     * @returns true if compaction is needed
     */
    private shouldCompactFromActual(actualTokens: number): boolean {
        if (!this.modelLimits || !this.compactionStrategy) {
            return false;
        }
        return this.compactionStrategy.shouldCompact(actualTokens, this.modelLimits);
    }

    /**
     * Compact context by generating a summary and adding it to the same session.
     *
     * The summary message is added to the conversation history with `isSummary: true` metadata.
     * When the context is loaded via getFormattedMessagesForLLM(), filterCompacted() will
     * exclude all messages before the summary, effectively compacting the context.
     *
     * @param originalTokens The estimated input token count that triggered overflow
     * @param contributorContext Context for system prompt contributors (needed for accurate token estimation)
     * @param tools Tool definitions (needed for accurate token estimation)
     * @returns true if compaction occurred, false if skipped
     */
    private async compactContext(
        originalTokens: number,
        contributorContext: DynamicContributorContext,
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<boolean> {
        if (!this.compactionStrategy) {
            return false;
        }

        this.logger.info(
            `Context overflow detected (${originalTokens} tokens), checking if compression is possible`
        );

        const history = await this.contextManager.getHistory();
        const { filterCompacted } = await import('../../context/utils.js');
        const originalFiltered = filterCompacted(history);
        const originalMessages = originalFiltered.length;

        // Pre-check if history is long enough for compaction (need at least 4 messages for meaningful summary)
        if (history.length < 4) {
            this.logger.debug('Compaction skipped: history too short to summarize');
            return false;
        }

        // Emit event BEFORE the LLM summarization call so UI shows indicator during compaction
        this.eventBus.emit('context:compacting', {
            estimatedTokens: originalTokens,
        });

        // Generate summary message(s) - this makes an LLM call
        const summaryMessages = await this.compactionStrategy.compact(history, {
            sessionId: this.sessionId,
            model: this.model,
            logger: this.logger,
        });

        if (summaryMessages.length === 0) {
            // Compaction returned empty - nothing to summarize (e.g., already compacted)
            // Still emit context:compacted to clear the UI's compacting state
            this.logger.debug(
                'Compaction skipped: strategy returned no summary (likely already compacted or nothing to summarize)'
            );
            this.eventBus.emit('context:compacted', {
                originalTokens,
                compactedTokens: originalTokens, // No change
                originalMessages,
                compactedMessages: originalMessages, // No change
                strategy: this.compactionStrategy.name,
                reason: 'overflow',
            });
            return false;
        }

        // Add summary to history - filterCompacted() will exclude pre-summary messages at read-time
        for (const summary of summaryMessages) {
            await this.contextManager.addMessage(summary);
        }

        // Reset actual token tracking since context has fundamentally changed
        // The formula (lastInput + lastOutput + newEstimate) is no longer valid after compaction
        this.contextManager.resetActualTokenTracking();

        // Get accurate token estimate after compaction using the same method as /context command
        // This ensures consistency between what we report and what /context shows
        const afterEstimate = await this.contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const compactedTokens = afterEstimate.estimated;
        const compactedMessages = afterEstimate.stats.filteredMessageCount;

        this.eventBus.emit('context:compacted', {
            originalTokens,
            compactedTokens,
            originalMessages,
            compactedMessages,
            strategy: this.compactionStrategy.name,
            reason: 'overflow',
        });

        this.logger.info(
            `Compaction complete: ${originalTokens} → ~${compactedTokens} tokens ` +
                `(${originalMessages} → ${compactedMessages} messages after filtering)`
        );

        return true;
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

    private getContextInputTokens(usage: TokenUsage): number | null {
        if (usage.inputTokens === undefined) return null;
        return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
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

            if (status === 402) {
                // Dexto gateway returns 402 with INSUFFICIENT_CREDITS when balance is low
                // Try to extract balance from response body
                let balance: number | undefined;
                try {
                    const parsed = JSON.parse(body);
                    // Format: { error: { code: 'INSUFFICIENT_CREDITS', message: '...Balance: $X.XX...' } }
                    const msg = parsed?.error?.message || '';
                    const match = msg.match(/Balance:\s*\$?([\d.]+)/i);
                    if (match) {
                        balance = parseFloat(match[1]);
                    }
                } catch {
                    // Ignore parse errors
                }
                return new DextoRuntimeError(
                    LLMErrorCode.INSUFFICIENT_CREDITS,
                    ErrorScope.LLM,
                    ErrorType.PAYMENT_REQUIRED,
                    `Insufficient Dexto credits${balance !== undefined ? `. Balance: $${balance.toFixed(2)}` : ''}`,
                    {
                        sessionId: this.sessionId,
                        provider: this.llmContext.provider,
                        model: this.llmContext.model,
                        status,
                        balance,
                        body,
                    },
                    'Run `dexto billing` to check your balance'
                );
            }
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
