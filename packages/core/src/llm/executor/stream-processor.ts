import { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { ContextManager } from '../../context/manager.js';
import { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { truncateToolResult } from './tool-output-truncator.js';
import { StreamProcessorResult } from './types.js';
import { sanitizeToolResult } from '../../context/utils.js';
import type { SanitizedToolResult } from '../../context/types.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { ToolPresentationSnapshotV1 } from '../../tools/types.js';
import type { LLMProvider, ReasoningVariant, TokenUsage } from '../types.js';

type UsageLike = {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
    reasoningTokens?: number | undefined;
    cachedInputTokens?: number | undefined;
    inputTokenDetails?: {
        noCacheTokens?: number | undefined;
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
    };
};

type FullStreamPart =
    StreamTextResult<VercelToolSet, unknown>['fullStream'] extends AsyncIterable<infer Part>
        ? Part
        : never;

// Defensive widenings: SDK v5 fields may drift between releases, so keep optional fallbacks.
type ToolInputStartEvent = Extract<FullStreamPart, { type: 'tool-input-start' }> & {
    toolCallId?: string;
    toolName?: string;
    id?: string;
    name?: string;
};

type ToolInputDeltaEvent = Extract<FullStreamPart, { type: 'tool-input-delta' }> & {
    toolCallId?: string;
    toolName?: string;
    inputTextDelta?: string;
    argsTextDelta?: string;
    delta?: string;
    textDelta?: string;
    id?: string;
    name?: string;
};

type ToolInputEndEvent = Extract<FullStreamPart, { type: 'tool-input-end' }> & {
    toolCallId?: string;
    id?: string;
};

export interface StreamProcessorConfig {
    provider: LLMProvider;
    model: string;
    /** Estimated input tokens before LLM call (for analytics/calibration) */
    estimatedInputTokens?: number;
    /** Reasoning variant used for this call, when the provider exposes it. */
    reasoningVariant?: ReasoningVariant;
    /** Reasoning budget tokens used for this call, when the provider exposes it. */
    reasoningBudgetTokens?: number;
}

export class StreamProcessor {
    private assistantMessageId: string | null = null;
    private actualTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    private finishReason: LLMFinishReason = 'unknown';
    private reasoningText: string = '';
    private reasoningMetadata: Record<string, unknown> | undefined;
    private accumulatedText: string = '';
    private logger: Logger;
    private hasStepUsage = false;
    /**
     * Track pending tool calls (added to context but no result yet).
     * On cancel/abort, we add synthetic "cancelled" results to maintain tool_use/tool_result pairing.
     */
    private pendingToolCalls: Map<string, { toolName: string }> = new Map();
    private partialToolCalls: Map<string, { toolName: string; argsText: string }> = new Map();

    /**
     * @param contextManager Context manager for message persistence
     * @param eventBus Event bus for emitting events
     * @param resourceManager Resource manager for blob storage
     * @param abortSignal Abort signal for cancellation
     * @param config Provider/model configuration
     * @param logger Logger instance
     * @param streaming If true, emits llm:chunk events. Default true.
     * @param toolCallMetadata Map of tool call IDs to tool-call metadata (approval + presentation)
     */
    constructor(
        private contextManager: ContextManager,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private abortSignal: AbortSignal,
        private config: StreamProcessorConfig,
        logger: Logger,
        private streaming: boolean = true,
        private toolCallMetadata?: Map<
            string,
            {
                presentationSnapshot?: ToolPresentationSnapshotV1;
                requireApproval?: boolean;
                approvalStatus?: 'approved' | 'rejected';
            }
        >
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
    }

    async process(
        streamFn: () => StreamTextResult<VercelToolSet, unknown>
    ): Promise<StreamProcessorResult> {
        const stream = streamFn();

        const handleToolInputStart = (evt: ToolInputStartEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const toolName = evt.toolName ?? evt.name ?? 'unknown';
            if (toolCallId) {
                this.partialToolCalls.set(toolCallId, { toolName, argsText: '' });
            }
        };

        const handleToolInputDelta = (evt: ToolInputDeltaEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const toolName = evt.toolName ?? evt.name ?? 'unknown';
            if (!toolCallId) return;
            const entry = this.partialToolCalls.get(toolCallId) ?? { toolName, argsText: '' };
            const deltaText =
                evt.argsTextDelta ?? evt.inputTextDelta ?? evt.delta ?? evt.textDelta ?? '';
            if (typeof deltaText === 'string' && deltaText.length > 0) {
                entry.argsText += deltaText;
                this.partialToolCalls.set(toolCallId, entry);
                const parsed = tryParsePartialJson(entry.argsText);
                if (parsed) {
                    this.eventBus.emit('llm:tool-call-partial', {
                        toolName: entry.toolName,
                        args: parsed,
                        callId: toolCallId,
                    });
                }
            }
        };

        const handleToolInputEnd = (evt: ToolInputEndEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const entry = toolCallId ? this.partialToolCalls.get(toolCallId) : undefined;
            if (toolCallId && entry) {
                const parsed = tryParsePartialJson(entry.argsText);
                if (parsed) {
                    this.eventBus.emit('llm:tool-call-partial', {
                        toolName: entry.toolName,
                        args: parsed,
                        callId: toolCallId,
                        isComplete: true,
                    });
                }
                this.partialToolCalls.delete(toolCallId);
            }
        };

        try {
            for await (const event of stream.fullStream) {
                // Don't call throwIfAborted() here - let Vercel SDK handle abort gracefully
                // and emit 'abort' event which we handle below in the switch

                switch (event.type) {
                    case 'text-delta':
                        if (!this.assistantMessageId) {
                            // Create assistant message on first text delta if not exists
                            this.assistantMessageId = await this.contextManager
                                .addAssistantMessage('', [], {})
                                .then(() => {
                                    return this.getLastMessageId();
                                });
                        }

                        await this.contextManager.appendAssistantText(
                            this.assistantMessageId!,
                            event.text
                        );

                        // Accumulate text for return value
                        this.accumulatedText += event.text;

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'text',
                                content: event.text,
                            });
                        }
                        break;

                    case 'reasoning-delta':
                        // Handle reasoning delta (extended thinking from Claude, etc.)
                        this.reasoningText += event.text;

                        // Capture provider metadata for round-tripping (e.g., OpenAI itemId, Gemini thought signatures)
                        // This must be passed back to the provider on subsequent requests
                        if (event.providerMetadata) {
                            this.mergeReasoningMetadata(event.providerMetadata);
                        }

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'reasoning',
                                content: event.text,
                            });
                        }
                        break;

                    case 'tool-input-start': {
                        handleToolInputStart(event);
                        break;
                    }

                    case 'tool-input-delta': {
                        handleToolInputDelta(event);
                        break;
                    }

                    case 'tool-input-end': {
                        handleToolInputEnd(event);
                        break;
                    }

                    case 'tool-call': {
                        // Create tool call record
                        if (!this.assistantMessageId) {
                            this.assistantMessageId = await this.createAssistantMessage();
                        }

                        // Extract providerMetadata for round-tripping (e.g., Gemini 3 thought signatures)
                        // These are opaque tokens that must be passed back to maintain model state
                        const toolCall: Parameters<typeof this.contextManager.addToolCall>[1] = {
                            id: event.toolCallId,
                            type: 'function',
                            function: {
                                name: event.toolName,
                                arguments: JSON.stringify(event.input),
                            },
                        };
                        // IMPORTANT: Only persist providerMetadata for providers that require round-tripping
                        // (e.g., Gemini thought signatures). OpenAI Responses metadata can cause invalid
                        // follow-up requests (function_call item references missing required reasoning items).
                        const shouldPersistProviderMetadata =
                            this.config.provider === 'google' || this.config.provider === 'vertex';

                        if (shouldPersistProviderMetadata && event.providerMetadata) {
                            toolCall.providerOptions = {
                                ...event.providerMetadata,
                            } as Record<string, unknown>;
                        }

                        await this.contextManager.addToolCall(this.assistantMessageId!, toolCall);

                        // Track pending tool call for abort handling
                        this.pendingToolCalls.set(event.toolCallId, {
                            toolName: event.toolName,
                        });
                        this.partialToolCalls.delete(event.toolCallId);

                        // NOTE: llm:tool-call is now emitted from ToolManager.executeTool() instead.
                        // This ensures correct event ordering - llm:tool-call arrives before approval:request.
                        // See tool-manager.ts for detailed explanation of the timing issue.
                        break;
                    }

                    case 'tool-result': {
                        // PERSISTENCE HAPPENS HERE
                        const rawResult = event.output;

                        // Log raw tool output for debugging
                        this.logger.debug('Tool result received', {
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            rawResult,
                        });

                        // Sanitize
                        const sanitized = await sanitizeToolResult(
                            rawResult,
                            {
                                blobStore: this.resourceManager.getBlobStore(),
                                toolName: event.toolName,
                                toolCallId: event.toolCallId,
                                success: true,
                            },
                            this.logger
                        );

                        // Truncate
                        const truncated = truncateToolResult(sanitized);

                        // Get tool-call metadata for this tool call
                        const metadata = this.toolCallMetadata?.get(event.toolCallId);

                        // Persist to history (success status comes from truncated.meta.success)
                        await this.contextManager.addToolResult(
                            event.toolCallId,
                            event.toolName,
                            truncated, // Includes meta.success from sanitization
                            metadata // Only tool-call metadata if present
                        );

                        this.eventBus.emit('llm:tool-result', {
                            toolName: event.toolName,
                            ...(metadata?.presentationSnapshot !== undefined && {
                                presentationSnapshot: metadata.presentationSnapshot,
                            }),
                            callId: event.toolCallId,
                            success: true,
                            sanitized: truncated,
                            rawResult: rawResult,
                            ...(metadata?.requireApproval !== undefined && {
                                requireApproval: metadata.requireApproval,
                            }),
                            ...(metadata?.approvalStatus !== undefined && {
                                approvalStatus: metadata.approvalStatus,
                            }),
                        });

                        // Clean up approval metadata after use
                        this.toolCallMetadata?.delete(event.toolCallId);
                        // Remove from pending (tool completed successfully)
                        this.pendingToolCalls.delete(event.toolCallId);
                        this.partialToolCalls.delete(event.toolCallId);
                        break;
                    }

                    case 'finish-step':
                        // Track token usage from completed steps for partial runs
                        // TODO: Token usage for cancelled mid-step responses is unavailable.
                        // LLM providers only send token counts in their final response chunk.
                        // If we abort mid-stream, that chunk never arrives. The tokens are
                        // still billed by the provider, but we can't report them.
                        if (event.usage) {
                            const providerMetadata = this.getProviderMetadata(event);
                            const stepUsage = this.normalizeUsage(event.usage, providerMetadata);

                            // Accumulate usage across steps
                            this.actualTokens = {
                                inputTokens:
                                    (this.actualTokens.inputTokens ?? 0) +
                                    (stepUsage.inputTokens ?? 0),
                                outputTokens:
                                    (this.actualTokens.outputTokens ?? 0) +
                                    (stepUsage.outputTokens ?? 0),
                                totalTokens:
                                    (this.actualTokens.totalTokens ?? 0) +
                                    (stepUsage.totalTokens ?? 0),
                                ...(stepUsage.reasoningTokens !== undefined && {
                                    reasoningTokens:
                                        (this.actualTokens.reasoningTokens ?? 0) +
                                        stepUsage.reasoningTokens,
                                }),
                                // Cache tokens
                                cacheReadTokens:
                                    (this.actualTokens.cacheReadTokens ?? 0) +
                                    (stepUsage.cacheReadTokens ?? 0),
                                cacheWriteTokens:
                                    (this.actualTokens.cacheWriteTokens ?? 0) +
                                    (stepUsage.cacheWriteTokens ?? 0),
                            };
                            this.hasStepUsage = true;
                        }
                        break;

                    case 'finish': {
                        this.finishReason = event.finishReason;

                        const providerMetadata = this.getProviderMetadata(event);
                        const fallbackUsage = this.normalizeUsage(
                            event.totalUsage,
                            providerMetadata
                        );
                        const usage = this.hasStepUsage ? { ...this.actualTokens } : fallbackUsage;

                        // Backfill usage fields from fallback when step usage reported zeros/undefined.
                        // This handles edge cases where providers send partial usage in finish-step
                        // events but complete usage in the final finish event (e.g., Anthropic sends
                        // cache tokens in providerMetadata rather than usage object).
                        if (this.hasStepUsage) {
                            // Backfill input/output tokens if step usage was zero but fallback has values.
                            // This is defensive - most providers report these consistently, but we log
                            // when backfill occurs to detect any providers with this edge case.
                            const fallbackInput = fallbackUsage.inputTokens ?? 0;
                            if ((usage.inputTokens ?? 0) === 0 && fallbackInput > 0) {
                                this.logger.debug(
                                    'Backfilling inputTokens from fallback usage (step reported 0)',
                                    { stepValue: usage.inputTokens, fallbackValue: fallbackInput }
                                );
                                usage.inputTokens = fallbackInput;
                            }
                            const fallbackOutput = fallbackUsage.outputTokens ?? 0;
                            if ((usage.outputTokens ?? 0) === 0 && fallbackOutput > 0) {
                                this.logger.debug(
                                    'Backfilling outputTokens from fallback usage (step reported 0)',
                                    { stepValue: usage.outputTokens, fallbackValue: fallbackOutput }
                                );
                                usage.outputTokens = fallbackOutput;
                            }
                            const fallbackCacheRead = fallbackUsage.cacheReadTokens ?? 0;
                            if ((usage.cacheReadTokens ?? 0) === 0 && fallbackCacheRead > 0) {
                                usage.cacheReadTokens = fallbackCacheRead;
                            }
                            const fallbackCacheWrite = fallbackUsage.cacheWriteTokens ?? 0;
                            if ((usage.cacheWriteTokens ?? 0) === 0 && fallbackCacheWrite > 0) {
                                usage.cacheWriteTokens = fallbackCacheWrite;
                            }
                            const fallbackTotalTokens = fallbackUsage.totalTokens ?? 0;
                            if ((usage.totalTokens ?? 0) === 0 && fallbackTotalTokens > 0) {
                                usage.totalTokens = fallbackTotalTokens;
                            }
                            if (
                                usage.reasoningTokens === undefined &&
                                fallbackUsage.reasoningTokens !== undefined
                            ) {
                                usage.reasoningTokens = fallbackUsage.reasoningTokens;
                            }
                        }

                        this.actualTokens = usage;

                        // Log LLM response metadata. Avoid logging full content at info level.
                        this.logger.info('LLM response complete', {
                            finishReason: event.finishReason,
                            contentLength: this.accumulatedText.length,
                            ...(this.reasoningText && {
                                reasoningLength: this.reasoningText.length,
                            }),
                            usage,
                            provider: this.config.provider,
                            model: this.config.model,
                        });

                        // Finalize assistant message with usage in reasoning
                        if (this.assistantMessageId) {
                            await this.contextManager.updateAssistantMessage(
                                this.assistantMessageId,
                                {
                                    tokenUsage: usage,
                                    // Persist reasoning text and metadata for round-tripping
                                    ...(this.reasoningText && { reasoning: this.reasoningText }),
                                    ...(this.reasoningMetadata && {
                                        reasoningMetadata: this.reasoningMetadata,
                                    }),
                                }
                            );
                        }

                        // Skip empty responses when tools are being called
                        // The meaningful response will come after tool execution completes
                        const hasContent = this.accumulatedText || this.reasoningText;
                        if (this.finishReason !== 'tool-calls' || hasContent) {
                            this.eventBus.emit('llm:response', {
                                content: this.accumulatedText,
                                ...(this.reasoningText && { reasoning: this.reasoningText }),
                                provider: this.config.provider,
                                model: this.config.model,
                                ...(this.config.reasoningVariant !== undefined && {
                                    reasoningVariant: this.config.reasoningVariant,
                                }),
                                ...(this.config.reasoningBudgetTokens !== undefined && {
                                    reasoningBudgetTokens: this.config.reasoningBudgetTokens,
                                }),
                                tokenUsage: usage,
                                ...(this.config.estimatedInputTokens !== undefined && {
                                    estimatedInputTokens: this.config.estimatedInputTokens,
                                }),
                                finishReason: this.finishReason,
                            });
                        }
                        break;
                    }

                    case 'tool-error': {
                        // Tool execution failed - emit error event with tool context
                        this.logger.error('Tool execution failed', {
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            error: event.error,
                        });

                        const errorMessage =
                            event.error instanceof Error
                                ? event.error.message
                                : String(event.error);

                        // CRITICAL: Must persist error result to history to maintain tool_use/tool_result pairing
                        // Without this, the conversation history has tool_use without tool_result,
                        // causing "tool_use ids were found without tool_result blocks" API errors
                        const errorResult: SanitizedToolResult = {
                            content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                            meta: {
                                toolName: event.toolName,
                                toolCallId: event.toolCallId,
                                success: false,
                            },
                        };

                        await this.contextManager.addToolResult(
                            event.toolCallId,
                            event.toolName,
                            errorResult,
                            undefined // No approval metadata for errors
                        );

                        this.eventBus.emit('llm:tool-result', {
                            toolName: event.toolName,
                            callId: event.toolCallId,
                            success: false,
                            error: errorMessage,
                        });

                        this.eventBus.emit('llm:error', {
                            error:
                                event.error instanceof Error
                                    ? event.error
                                    : new Error(String(event.error)),
                            context: `Tool execution failed: ${event.toolName}`,
                            toolCallId: event.toolCallId,
                            recoverable: true, // Tool errors are typically recoverable
                        });
                        // Remove from pending (tool failed but result was persisted)
                        this.pendingToolCalls.delete(event.toolCallId);
                        this.partialToolCalls.delete(event.toolCallId);
                        break;
                    }

                    case 'error': {
                        const err =
                            event.error instanceof Error
                                ? event.error
                                : new Error(String(event.error));
                        this.logger.error(`LLM error: ${err.toString()}}`);
                        this.eventBus.emit('llm:error', {
                            error: err,
                        });
                        break;
                    }

                    case 'abort':
                        // Vercel SDK emits 'abort' when the stream is cancelled
                        this.logger.debug('Stream aborted, emitting partial response');
                        this.finishReason = 'cancelled';

                        // Persist cancelled results for any pending tool calls
                        await this.persistCancelledToolResults();

                        this.eventBus.emit('llm:response', {
                            content: this.accumulatedText,
                            ...(this.reasoningText && { reasoning: this.reasoningText }),
                            provider: this.config.provider,
                            model: this.config.model,
                            ...(this.config.reasoningVariant !== undefined && {
                                reasoningVariant: this.config.reasoningVariant,
                            }),
                            ...(this.config.reasoningBudgetTokens !== undefined && {
                                reasoningBudgetTokens: this.config.reasoningBudgetTokens,
                            }),
                            tokenUsage: this.actualTokens,
                            ...(this.config.estimatedInputTokens !== undefined && {
                                estimatedInputTokens: this.config.estimatedInputTokens,
                            }),
                            finishReason: 'cancelled',
                        });

                        // Return immediately - stream will close after abort event
                        return {
                            text: this.accumulatedText,
                            finishReason: 'cancelled',
                            usage: this.actualTokens,
                        };
                }
            }
        } catch (error) {
            // Check if this is an abort error (intentional cancellation)
            // Note: DOMException extends Error in Node.js 17+, so the first check covers it
            const isAbortError =
                (error instanceof Error && error.name === 'AbortError') || this.abortSignal.aborted;

            if (isAbortError) {
                // Emit final response with accumulated content on cancellation
                this.logger.debug('Stream cancelled, emitting partial response');
                this.finishReason = 'cancelled';

                // Persist cancelled results for any pending tool calls
                await this.persistCancelledToolResults();

                this.eventBus.emit('llm:response', {
                    content: this.accumulatedText,
                    ...(this.reasoningText && { reasoning: this.reasoningText }),
                    provider: this.config.provider,
                    model: this.config.model,
                    ...(this.config.reasoningVariant !== undefined && {
                        reasoningVariant: this.config.reasoningVariant,
                    }),
                    ...(this.config.reasoningBudgetTokens !== undefined && {
                        reasoningBudgetTokens: this.config.reasoningBudgetTokens,
                    }),
                    tokenUsage: this.actualTokens,
                    ...(this.config.estimatedInputTokens !== undefined && {
                        estimatedInputTokens: this.config.estimatedInputTokens,
                    }),
                    finishReason: 'cancelled',
                });

                // Don't throw - cancellation is intentional, not an error
                return {
                    text: this.accumulatedText,
                    finishReason: 'cancelled',
                    usage: this.actualTokens,
                };
            }

            // Non-abort errors are real failures
            this.logger.error('Stream processing failed', { error });

            // Emit error event so UI knows about the failure
            this.eventBus.emit('llm:error', {
                error: error instanceof Error ? error : new Error(String(error)),
                context: 'StreamProcessor',
                recoverable: false,
            });

            throw error;
        }

        return {
            text: this.accumulatedText,
            finishReason: this.finishReason,
            usage: this.actualTokens,
        };
    }

    private getCacheTokensFromProviderMetadata(
        providerMetadata: Record<string, unknown> | undefined
    ): { cacheReadTokens: number; cacheWriteTokens: number } {
        const anthropicMeta = providerMetadata?.['anthropic'] as Record<string, number> | undefined;
        const bedrockMeta = providerMetadata?.['bedrock'] as
            | { usage?: Record<string, number> }
            | undefined;

        const cacheWriteTokens =
            anthropicMeta?.['cacheCreationInputTokens'] ??
            bedrockMeta?.usage?.['cacheWriteInputTokens'] ??
            0;
        const cacheReadTokens =
            anthropicMeta?.['cacheReadInputTokens'] ??
            bedrockMeta?.usage?.['cacheReadInputTokens'] ??
            0;

        return { cacheReadTokens, cacheWriteTokens };
    }

    private normalizeUsage(
        usage: UsageLike | undefined,
        providerMetadata?: Record<string, unknown>
    ): TokenUsage {
        const inputTokensRaw = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        const totalTokens = usage?.totalTokens ?? 0;
        const reasoningTokens = usage?.reasoningTokens;
        const cachedInputTokens = usage?.cachedInputTokens;
        const inputTokenDetails = usage?.inputTokenDetails;

        const providerCache = this.getCacheTokensFromProviderMetadata(providerMetadata);
        const cacheReadTokens =
            inputTokenDetails?.cacheReadTokens ??
            cachedInputTokens ??
            providerCache.cacheReadTokens ??
            0;
        const cacheWriteTokens =
            inputTokenDetails?.cacheWriteTokens ?? providerCache.cacheWriteTokens ?? 0;

        const needsCacheWriteAdjustment =
            inputTokenDetails === undefined &&
            cachedInputTokens !== undefined &&
            providerCache.cacheWriteTokens > 0;
        const noCacheTokens =
            inputTokenDetails?.noCacheTokens ??
            (cachedInputTokens !== undefined
                ? inputTokensRaw -
                  cachedInputTokens -
                  (needsCacheWriteAdjustment ? providerCache.cacheWriteTokens : 0)
                : inputTokensRaw);

        return {
            inputTokens: Math.max(0, noCacheTokens),
            outputTokens,
            totalTokens,
            ...(reasoningTokens !== undefined && { reasoningTokens }),
            cacheReadTokens,
            cacheWriteTokens,
        };
    }

    private getProviderMetadata(
        event: Record<string, unknown>
    ): Record<string, unknown> | undefined {
        const metadata =
            'providerMetadata' in event
                ? (event as { providerMetadata?: Record<string, unknown> }).providerMetadata
                : undefined;
        if (!metadata || typeof metadata !== 'object') {
            return undefined;
        }
        return metadata;
    }

    private mergeReasoningMetadata(providerMetadata: Record<string, unknown>): void {
        if (!this.reasoningMetadata) {
            this.reasoningMetadata = providerMetadata;
            return;
        }

        const isRecord = (value: unknown): value is Record<string, unknown> =>
            !!value && typeof value === 'object' && !Array.isArray(value);

        const previous = this.reasoningMetadata;
        const merged: Record<string, unknown> = { ...previous, ...providerMetadata };

        const previousOpenRouter = previous['openrouter'];
        const nextOpenRouter = providerMetadata['openrouter'];
        if (isRecord(previousOpenRouter) && isRecord(nextOpenRouter)) {
            // OpenRouter streams `reasoning_details` incrementally across multiple reasoning-delta events.
            // Plain overwrite/shallow merge drops earlier entries, so we append that array explicitly.
            // We intentionally avoid a generic deep-merge for all providers because providerMetadata
            // shapes are provider-specific/opaque and broad deep-merging can introduce invalid payloads.
            const previousDetails = previousOpenRouter['reasoning_details'];
            const nextDetails = nextOpenRouter['reasoning_details'];
            const combinedDetails =
                Array.isArray(previousDetails) && Array.isArray(nextDetails)
                    ? [...previousDetails, ...nextDetails]
                    : Array.isArray(nextDetails)
                      ? nextDetails
                      : Array.isArray(previousDetails)
                        ? previousDetails
                        : undefined;

            merged['openrouter'] = {
                ...previousOpenRouter,
                ...nextOpenRouter,
                ...(combinedDetails ? { reasoning_details: combinedDetails } : {}),
            };
        }

        this.reasoningMetadata = merged;
    }

    private async createAssistantMessage(): Promise<string> {
        await this.contextManager.addAssistantMessage('', [], {});
        return this.getLastMessageId();
    }

    private async getLastMessageId(): Promise<string> {
        const history = await this.contextManager.getHistory();
        const last = history[history.length - 1];
        if (!last || !last.id) throw new Error('Failed to get last message ID');
        return last.id;
    }

    /**
     * Persist synthetic "cancelled" results for all pending tool calls.
     * This maintains the tool_use/tool_result pairing required by LLM APIs.
     * Called on abort/cancel to prevent "tool_use ids were found without tool_result" errors.
     */
    private async persistCancelledToolResults(): Promise<void> {
        if (this.pendingToolCalls.size === 0) return;

        this.logger.debug(
            `Persisting cancelled results for ${this.pendingToolCalls.size} pending tool call(s)`
        );

        for (const [toolCallId, { toolName }] of this.pendingToolCalls) {
            const cancelledResult: SanitizedToolResult = {
                content: [{ type: 'text', text: 'Cancelled by user' }],
                meta: {
                    toolName,
                    toolCallId,
                    success: false,
                },
            };

            await this.contextManager.addToolResult(
                toolCallId,
                toolName,
                cancelledResult,
                undefined // No approval metadata for cancelled tools
            );

            // Emit tool-result event so CLI/WebUI can update UI
            this.eventBus.emit('llm:tool-result', {
                toolName,
                callId: toolCallId,
                success: false,
                error: 'Cancelled by user',
            });
        }

        this.pendingToolCalls.clear();
    }
}

function tryParsePartialJson(input: string): Record<string, unknown> | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{')) return null;

    let repaired = trimmed;

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < repaired.length; i += 1) {
        const char = repaired[i];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (char === '\\') {
                isEscaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') openBraces += 1;
        if (char === '}') openBraces = Math.max(0, openBraces - 1);
        if (char === '[') openBrackets += 1;
        if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }

    if (!inString) {
        repaired = repaired.replace(/,\s*$/, '');
    }
    if (inString) {
        if (isEscaped) {
            repaired = repaired.slice(0, -1);
        }
        repaired += '"';
    }
    if (openBrackets > 0) {
        repaired += ']'.repeat(openBrackets);
    }
    if (openBraces > 0) {
        repaired += '}'.repeat(openBraces);
    }

    try {
        const parsed = JSON.parse(repaired) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return null;
    }

    return null;
}
