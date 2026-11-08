import { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { trace } from '@opentelemetry/api';
import { ContextManager } from '../../context/manager.js';
import { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import { StreamProcessorResult } from './types.js';
import type { AssistantOutputLifecycle, SanitizedToolResult } from '../../context/types.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { ModelToolCall } from './types.js';
import { getUsagePricingMetadata } from '../usage-metadata.js';
import type { TokenUsageCostBreakdown } from '@dexto/llm';
import type { LLMProvider, LLMPricingStatus, ReasoningVariant, TokenUsage } from '@dexto/llm';
import { extractProviderErrorDetails, mapProviderError } from './provider-error.js';
import { isEmptyModelResponse } from './empty-response.js';
import { LLMError } from '../errors.js';

/**
 * How long a model stream may send no event before its attempt counts as stalled. Production
 * (DEXTO-2093) has waited up to 715 s for a first text (kimi-k3) and 308 s for a first reasoning
 * delta (gpt-6.1-sol), and no stream ran 15 minutes in 30 days. Three attempts still fit inside
 * Dexto Cloud's one-hour model step.
 */
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 15 * 60_000;

/**
 * Yields the stream's events and throws `stall()` once none arrives within
 * MODEL_STREAM_IDLE_TIMEOUT_MS. Each read races the timer, so a socket that never answers, even
 * after abort, cannot hold the turn.
 */
async function* readUntilStalled<T>(
    events: AsyncIterable<T>,
    stall: () => Error
): AsyncGenerator<T> {
    const iterator = events[Symbol.asyncIterator]();
    try {
        for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const stalled = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(stall()), MODEL_STREAM_IDLE_TIMEOUT_MS);
            });
            let next: IteratorResult<T>;
            try {
                next = await Promise.race([iterator.next(), stalled]);
            } finally {
                clearTimeout(timer);
            }
            if (next.done) return;
            yield next.value;
        }
    } finally {
        // Not awaited: a stalled read never settles, and the attempt's abort already closes it.
        void iterator.return?.()?.catch(() => {});
    }
}

type UsageLike = {
    inputTokens?: number | null | undefined;
    outputTokens?: number | null | undefined;
    totalTokens?: number | null | undefined;
    reasoningTokens?: number | null | undefined;
    cachedInputTokens?: number | null | undefined;
    inputTokenDetails?: {
        noCacheTokens?: number | null | undefined;
        cacheReadTokens?: number | null | undefined;
        cacheWriteTokens?: number | null | undefined;
    };
};

function finiteUsageCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type FullStreamPart =
    StreamTextResult<VercelToolSet, unknown>['fullStream'] extends AsyncIterable<infer Part>
        ? Part
        : never;

function assistantOutputForFinishReason(finishReason: LLMFinishReason): AssistantOutputLifecycle {
    switch (finishReason) {
        case 'cancelled':
            return { status: 'stopped', reason: 'cancelled' };
        case 'error':
            return { status: 'stopped', reason: 'failed' };
        default:
            return { status: 'complete' };
    }
}

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

/**
 * What to put before a delta so that a new stream block reads as a new paragraph: a blank line
 * when the delta is the first content of a block other than the one before it. Nothing for the
 * first block, for an empty delta, for a stream that gives no block ids, or where the text so far
 * already ends in a blank line.
 */
function blockSeparator(
    previousBlockId: string | undefined,
    blockId: string | undefined,
    accumulated: string,
    delta: string
): string {
    if (delta === '' || accumulated === '') return '';
    if (blockId === undefined || previousBlockId === undefined || blockId === previousBlockId) {
        return '';
    }
    if (accumulated.endsWith('\n\n')) return '';
    return accumulated.endsWith('\n') ? '\n' : '\n\n';
}

export interface StreamProcessorConfig {
    provider: LLMProvider;
    model: string;
    llmRegistry?: import('@dexto/llm').ModelRegistry;
    usageScopeId?: string;
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
    /** The stream block the last text or reasoning came from; a new id starts a new paragraph. */
    private lastTextBlockId: string | undefined;
    private lastReasoningBlockId: string | undefined;
    private logger: Logger;
    private hasStepUsage = false;
    private readonly usageScopeId: string | undefined;
    private modelToolCalls: ModelToolCall[] = [];
    /** An empty text delta arrived before any message; its draft is created only if kept. */
    private hasDeferredAssistantMessage = false;
    /** The finish was an empty reply, held back for TurnExecutor to retry or fail. */
    private emptyResponseHeld = false;
    /**
     * Track pending tool calls (added to context but no result yet).
     * On cancel/abort, we add synthetic "cancelled" results to maintain tool_use/tool_result pairing.
     */
    private pendingToolCalls: Map<string, { toolName: string }> = new Map();
    private partialToolCalls: Map<string, { toolName: string; argsText: string }> = new Map();

    /**
     * @param contextManager Context manager for message persistence
     * @param eventBus Event bus for emitting events
     * @param abortSignal Abort signal for cancellation
     * @param config Provider/model configuration
     * @param logger Logger instance
     * @param streaming If true, emits llm:chunk events. Default true.
     * @param emitFatalErrors If true, emits terminal llm:error events. TurnExecutor owns
     * terminal run errors and disables this to avoid duplicate events.
     */
    constructor(
        private contextManager: ContextManager,
        private eventBus: SessionEventBus,
        private abortSignal: AbortSignal,
        private config: StreamProcessorConfig,
        logger: Logger,
        private streaming: boolean = true,
        private emitFatalErrors: boolean = true
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
        this.usageScopeId = config.usageScopeId;
    }

    /** Runs one model attempt. `streamFn` must send its request with the given abort signal. */
    async process(
        streamFn: (abortSignal: AbortSignal) => StreamTextResult<VercelToolSet, unknown>
    ): Promise<StreamProcessorResult> {
        const startedAtMs = Date.now();
        const setStreamAttribute = (name: string, value: number | string): void => {
            trace.getActiveSpan()?.setAttribute(`llm.stream.${name}`, value);
        };
        const markTiming = (name: string): number => {
            const elapsedMs = Date.now() - startedAtMs;
            setStreamAttribute(`${name}_ms`, elapsedMs);
            return elapsedMs;
        };
        const stallAbort = new AbortController();
        const stream = streamFn(AbortSignal.any([this.abortSignal, stallAbort.signal]));
        const events = readUntilStalled(stream.fullStream, () => {
            stallAbort.abort();
            return LLMError.streamStalled(
                this.config.provider,
                this.config.model,
                MODEL_STREAM_IDLE_TIMEOUT_MS
            );
        });
        let lastEventReceivedAtMs = startedAtMs;
        let maxEventGapMs = 0;
        let lastDeltaReceivedAtMs: number | null = null;
        let lastReasoningDeltaReceivedAtMs: number | null = null;
        let lastTextDeltaReceivedAtMs: number | null = null;
        let reasoningDeltaCount = 0;
        let textDeltaCount = 0;

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
            for await (const event of events) {
                // Don't call throwIfAborted() here - let Vercel SDK handle abort gracefully
                // and emit 'abort' event which we handle below in the switch
                const eventReceivedAtMs = Date.now();
                if (eventReceivedAtMs - lastEventReceivedAtMs > maxEventGapMs) {
                    maxEventGapMs = eventReceivedAtMs - lastEventReceivedAtMs;
                    setStreamAttribute('max_event_gap_ms', maxEventGapMs);
                }
                lastEventReceivedAtMs = eventReceivedAtMs;

                switch (event.type) {
                    case 'text-delta': {
                        if (textDeltaCount === 0) {
                            markTiming('first_text_delta_received');
                        }
                        textDeltaCount += 1;
                        setStreamAttribute('text_delta_count', textDeltaCount);
                        lastTextDeltaReceivedAtMs = markTiming('last_text_delta_received');
                        lastDeltaReceivedAtMs = lastTextDeltaReceivedAtMs;
                        setStreamAttribute('last_delta_received_ms', lastDeltaReceivedAtMs);
                        setStreamAttribute('last_delta_kind', 'text');
                        // An empty delta carries nothing. Defer its draft so an empty reply
                        // leaves history unchanged and can be retried.
                        if (event.text === '' && !this.assistantMessageId) {
                            this.hasDeferredAssistantMessage = true;
                            break;
                        }
                        if (!this.assistantMessageId) {
                            // Create assistant message on first text delta if not exists
                            this.assistantMessageId = await this.contextManager.addAssistantMessage(
                                '',
                                [],
                                {
                                    assistantOutput: { status: 'draft' },
                                }
                            );
                        }

                        // A second text block in one step starts a new paragraph. The same string is
                        // stored, returned and streamed, so all three stay identical.
                        const text =
                            blockSeparator(
                                this.lastTextBlockId,
                                event.id,
                                this.accumulatedText,
                                event.text
                            ) + event.text;
                        if (event.text !== '') this.lastTextBlockId = event.id;

                        await this.contextManager.appendAssistantText(
                            this.assistantMessageId!,
                            text
                        );

                        // Accumulate text for return value
                        this.accumulatedText += text;

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'text',
                                content: text,
                            });
                        }
                        markTiming('last_text_delta_emitted');
                        break;
                    }

                    case 'reasoning-delta': {
                        if (reasoningDeltaCount === 0) {
                            markTiming('first_reasoning_delta_received');
                        }
                        reasoningDeltaCount += 1;
                        setStreamAttribute('reasoning_delta_count', reasoningDeltaCount);
                        lastReasoningDeltaReceivedAtMs = markTiming(
                            'last_reasoning_delta_received'
                        );
                        lastDeltaReceivedAtMs = lastReasoningDeltaReceivedAtMs;
                        setStreamAttribute('last_delta_received_ms', lastDeltaReceivedAtMs);
                        setStreamAttribute('last_delta_kind', 'reasoning');
                        // Handle reasoning delta (extended thinking from Claude, etc.). A second
                        // reasoning block in one step starts a new paragraph, as text blocks do.
                        const reasoning =
                            blockSeparator(
                                this.lastReasoningBlockId,
                                event.id,
                                this.reasoningText,
                                event.text
                            ) + event.text;
                        if (event.text !== '') this.lastReasoningBlockId = event.id;
                        this.reasoningText += reasoning;

                        // Capture provider metadata for round-tripping (e.g., OpenAI itemId, Gemini thought signatures)
                        // This must be passed back to the provider on subsequent requests
                        if (event.providerMetadata) {
                            this.mergeReasoningMetadata(event.providerMetadata);
                        }

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'reasoning',
                                content: reasoning,
                            });
                        }
                        markTiming('last_reasoning_delta_emitted');
                        break;
                    }

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
                        this.modelToolCalls.push({
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            input: event.input,
                        });

                        // Track pending tool call for abort handling
                        this.pendingToolCalls.set(event.toolCallId, {
                            toolName: event.toolName,
                        });
                        this.partialToolCalls.delete(event.toolCallId);

                        // TurnExecutor emits llm:tool-call after preparation so the UI receives
                        // normalized presentation metadata before approval handling starts.
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
                                // TODO(token-usage): Use a shared totalTokens resolver instead of raw `?? 0`.
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
                        const finishEventReceivedAtMs = markTiming('finish_event_received');
                        if (lastTextDeltaReceivedAtMs !== null) {
                            setStreamAttribute(
                                'finish_after_last_text_delta_ms',
                                finishEventReceivedAtMs - lastTextDeltaReceivedAtMs
                            );
                        }
                        if (lastReasoningDeltaReceivedAtMs !== null) {
                            setStreamAttribute(
                                'finish_after_last_reasoning_delta_ms',
                                finishEventReceivedAtMs - lastReasoningDeltaReceivedAtMs
                            );
                        }
                        if (lastDeltaReceivedAtMs !== null) {
                            setStreamAttribute(
                                'finish_after_last_delta_ms',
                                finishEventReceivedAtMs - lastDeltaReceivedAtMs
                            );
                        }
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

                        const isEmptyResponse = isEmptyModelResponse({
                            text: this.accumulatedText,
                            finishReason: this.finishReason,
                            usage,
                            toolCalls: this.modelToolCalls,
                        });
                        // A cancelled step that ended empty is a cancellation, not a reply.
                        if (isEmptyResponse && this.abortSignal.aborted) {
                            this.finishReason = 'cancelled';
                        } else if (isEmptyResponse) {
                            // TurnExecutor retries or fails an empty reply, so it is not a
                            // response: hosts must not finalize the reasoning streamed so far.
                            this.emptyResponseHeld = true;
                            this.logger.warn('LLM ended its reply without answering', {
                                finishReason: event.finishReason,
                                ...(this.reasoningText && {
                                    reasoningLength: this.reasoningText.length,
                                }),
                                provider: this.config.provider,
                                model: this.config.model,
                            });
                            break;
                        }

                        const pricingMetadata = getUsagePricingMetadata({
                            provider: this.config.provider,
                            model: this.config.model,
                            tokenUsage: usage,
                            ...(this.config.llmRegistry !== undefined && {
                                llmRegistry: this.config.llmRegistry,
                            }),
                        });

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

                        markTiming('metadata_persist_started');
                        await this.persistAssistantResponseMetadata(
                            usage,
                            pricingMetadata,
                            assistantOutputForFinishReason(this.finishReason)
                        );
                        markTiming('metadata_persist_finished');

                        // Skip empty responses when tools are being called
                        // The meaningful response will come after tool execution completes
                        const hasContent = this.accumulatedText || this.reasoningText;
                        if (this.finishReason !== 'tool-calls' || hasContent) {
                            markTiming('llm_response_emit_started');
                            this.emitLLMResponse({
                                tokenUsage: usage,
                                finishReason: this.finishReason,
                                ...pricingMetadata,
                            });
                            markTiming('llm_response_emitted');
                        }
                        break;
                    }

                    case 'error': {
                        const err = mapProviderError({
                            error: event.error,
                            provider: this.config.provider,
                            model: this.config.model,
                        });
                        await this.persistFailedToolResults(err.message);
                        throw event.error;
                    }

                    case 'abort': {
                        // Vercel SDK emits 'abort' when the stream is cancelled
                        this.logger.debug('Stream aborted, emitting partial response');
                        this.finishReason = 'cancelled';

                        // Persist cancelled results for any pending tool calls
                        await this.persistCancelledToolResults();

                        const abortPricingMetadata = getUsagePricingMetadata({
                            provider: this.config.provider,
                            model: this.config.model,
                            tokenUsage: this.actualTokens,
                            ...(this.config.llmRegistry !== undefined && {
                                llmRegistry: this.config.llmRegistry,
                            }),
                        });
                        await this.persistAssistantResponseMetadata(
                            this.actualTokens,
                            abortPricingMetadata,
                            { status: 'stopped', reason: 'cancelled' }
                        );

                        this.emitLLMResponse({
                            tokenUsage: this.actualTokens,
                            finishReason: 'cancelled',
                            ...abortPricingMetadata,
                        });

                        // Return immediately - stream will close after abort event
                        return {
                            text: this.accumulatedText,
                            finishReason: 'cancelled',
                            usage: this.actualTokens,
                            toolCalls: this.modelToolCalls,
                        };
                    }
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

                const abortPricingMetadata = getUsagePricingMetadata({
                    provider: this.config.provider,
                    model: this.config.model,
                    tokenUsage: this.actualTokens,
                    ...(this.config.llmRegistry !== undefined && {
                        llmRegistry: this.config.llmRegistry,
                    }),
                });
                await this.persistAssistantResponseMetadata(
                    this.actualTokens,
                    abortPricingMetadata,
                    { status: 'stopped', reason: 'cancelled' }
                );

                this.emitLLMResponse({
                    tokenUsage: this.actualTokens,
                    finishReason: 'cancelled',
                    ...abortPricingMetadata,
                });

                // Don't throw - cancellation is intentional, not an error
                return {
                    text: this.accumulatedText,
                    finishReason: 'cancelled',
                    usage: this.actualTokens,
                    toolCalls: this.modelToolCalls,
                };
            }

            // Non-abort errors are real failures
            const mappedError = mapProviderError({
                error,
                provider: this.config.provider,
                model: this.config.model,
            });
            const failurePricingMetadata = getUsagePricingMetadata({
                provider: this.config.provider,
                model: this.config.model,
                tokenUsage: this.actualTokens,
                ...(this.config.llmRegistry !== undefined && {
                    llmRegistry: this.config.llmRegistry,
                }),
            });
            await this.persistAssistantResponseMetadata(this.actualTokens, failurePricingMetadata, {
                status: 'stopped',
                reason: 'failed',
            });

            if (!this.emitFatalErrors) {
                this.logger.error('Stream processing failed', { error: mappedError });
                // A provider Error goes up as-is for the caller's retry and mapping; anything
                // else (a string, or an SSE `{ code, message }` object) as the mapped Error.
                throw error instanceof Error ? error : mappedError;
            }

            if (this.emitFatalErrors) {
                this.eventBus.emit('llm:error', {
                    error: mappedError,
                    context: 'StreamProcessor',
                    recoverable: false,
                    details: extractProviderErrorDetails({
                        error,
                        provider: this.config.provider,
                        model: this.config.model,
                    }),
                });
            }
            this.logger.error('Stream processing failed', { error: mappedError });
            throw mappedError;
        }

        markTiming('full_stream_iterator_completed');
        if (this.emptyResponseHeld && this.abortSignal.aborted) {
            // Cancelled after the empty finish: finalize as a cancellation like any other.
            return this.finishCancelled();
        }
        return {
            text: this.accumulatedText,
            finishReason: this.finishReason,
            usage: this.actualTokens,
            toolCalls: this.modelToolCalls,
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
            finiteUsageCount(anthropicMeta?.['cacheCreationInputTokens']) ??
            finiteUsageCount(bedrockMeta?.usage?.['cacheWriteInputTokens']) ??
            0;
        const cacheReadTokens =
            finiteUsageCount(anthropicMeta?.['cacheReadInputTokens']) ??
            finiteUsageCount(bedrockMeta?.usage?.['cacheReadInputTokens']) ??
            0;

        return { cacheReadTokens, cacheWriteTokens };
    }

    private normalizeUsage(
        usage: UsageLike | undefined,
        providerMetadata?: Record<string, unknown>
    ): TokenUsage {
        const inputTokensRaw = finiteUsageCount(usage?.inputTokens) ?? 0;
        const outputTokens = finiteUsageCount(usage?.outputTokens) ?? 0;
        const totalTokens = finiteUsageCount(usage?.totalTokens) ?? 0;
        const reasoningTokens = finiteUsageCount(usage?.reasoningTokens);
        const cachedInputTokens = finiteUsageCount(usage?.cachedInputTokens);
        const inputTokenDetails = usage?.inputTokenDetails;

        const providerCache = this.getCacheTokensFromProviderMetadata(providerMetadata);
        const cacheReadTokens =
            finiteUsageCount(inputTokenDetails?.cacheReadTokens) ??
            cachedInputTokens ??
            providerCache.cacheReadTokens ??
            0;
        const cacheWriteTokens =
            finiteUsageCount(inputTokenDetails?.cacheWriteTokens) ??
            providerCache.cacheWriteTokens ??
            0;

        const needsCacheWriteAdjustment =
            inputTokenDetails === undefined &&
            cachedInputTokens !== undefined &&
            providerCache.cacheWriteTokens > 0;
        const noCacheTokens =
            finiteUsageCount(inputTokenDetails?.noCacheTokens) ??
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

    private getReasoningResponseFields(): {
        reasoningVariant?: ReasoningVariant;
        reasoningBudgetTokens?: number;
    } {
        return {
            ...(this.config.reasoningVariant !== undefined && {
                reasoningVariant: this.config.reasoningVariant,
            }),
            ...(this.config.reasoningBudgetTokens !== undefined && {
                reasoningBudgetTokens: this.config.reasoningBudgetTokens,
            }),
        };
    }

    private emitLLMResponse(config: {
        tokenUsage: TokenUsage;
        finishReason: LLMFinishReason;
        estimatedCost?: number;
        costBreakdown?: TokenUsageCostBreakdown;
        pricingStatus?: LLMPricingStatus;
    }): void {
        this.eventBus.emit('llm:response', {
            content: this.accumulatedText,
            ...(this.reasoningText && { reasoning: this.reasoningText }),
            provider: this.config.provider,
            model: this.config.model,
            ...this.getReasoningResponseFields(),
            tokenUsage: config.tokenUsage,
            ...(this.assistantMessageId && { messageId: this.assistantMessageId }),
            ...(this.usageScopeId && { usageScopeId: this.usageScopeId }),
            ...(config.estimatedCost !== undefined && {
                estimatedCost: config.estimatedCost,
            }),
            ...(config.costBreakdown && {
                costBreakdown: config.costBreakdown,
            }),
            ...(config.pricingStatus && { pricingStatus: config.pricingStatus }),
            ...(this.config.estimatedInputTokens !== undefined && {
                estimatedInputTokens: this.config.estimatedInputTokens,
            }),
            finishReason: config.finishReason,
        });
    }

    private async persistAssistantResponseMetadata(
        tokenUsage: TokenUsage,
        pricingMetadata: ReturnType<typeof getUsagePricingMetadata>,
        assistantOutput: AssistantOutputLifecycle
    ): Promise<void> {
        if (!this.assistantMessageId && this.hasDeferredAssistantMessage) {
            this.assistantMessageId = await this.createAssistantMessage();
        }
        if (!this.assistantMessageId) {
            return;
        }

        await this.contextManager.updateAssistantMessage(this.assistantMessageId, {
            tokenUsage,
            ...(pricingMetadata.estimatedCost !== undefined && {
                estimatedCost: pricingMetadata.estimatedCost,
            }),
            ...(pricingMetadata.pricingStatus && {
                pricingStatus: pricingMetadata.pricingStatus,
            }),
            ...(this.usageScopeId && {
                usageScopeId: this.usageScopeId,
            }),
            ...(this.reasoningText && { reasoning: this.reasoningText }),
            ...(this.reasoningMetadata && {
                reasoningMetadata: this.reasoningMetadata,
            }),
            assistantOutput,
        });
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

    private async finishCancelled(): Promise<StreamProcessorResult> {
        this.finishReason = 'cancelled';
        await this.persistCancelledToolResults();
        const pricingMetadata = getUsagePricingMetadata({
            provider: this.config.provider,
            model: this.config.model,
            tokenUsage: this.actualTokens,
            ...(this.config.llmRegistry !== undefined && {
                llmRegistry: this.config.llmRegistry,
            }),
        });
        await this.persistAssistantResponseMetadata(this.actualTokens, pricingMetadata, {
            status: 'stopped',
            reason: 'cancelled',
        });
        this.emitLLMResponse({
            tokenUsage: this.actualTokens,
            finishReason: 'cancelled',
            ...pricingMetadata,
        });
        return {
            text: this.accumulatedText,
            finishReason: 'cancelled',
            usage: this.actualTokens,
            toolCalls: this.modelToolCalls,
        };
    }

    private async createAssistantMessage(): Promise<string> {
        return this.contextManager.addAssistantMessage('', [], {
            assistantOutput: { status: 'draft' },
        });
    }

    /**
     * Persist synthetic "cancelled" results for all pending tool calls.
     * This maintains the tool_use/tool_result pairing required by LLM APIs.
     * Called on abort/cancel to prevent "tool_use ids were found without tool_result" errors.
     */
    private async persistCancelledToolResults(): Promise<void> {
        await this.persistPendingToolResults({
            logLabel: 'cancelled',
            resultText: 'Cancelled by user',
            errorMessage: 'Cancelled by user',
        });
    }

    /**
     * Persist synthetic failed results for pending tool calls before surfacing a fatal stream error.
     */
    private async persistFailedToolResults(errorMessage: string): Promise<void> {
        await this.persistPendingToolResults({
            logLabel: 'failed',
            resultText: `Error: ${errorMessage}`,
            errorMessage,
        });
    }

    private async persistPendingToolResults(options: {
        logLabel: 'cancelled' | 'failed';
        resultText: string;
        errorMessage: string;
    }): Promise<void> {
        if (this.pendingToolCalls.size === 0) return;

        this.logger.debug(
            `Persisting ${options.logLabel} results for ${this.pendingToolCalls.size} pending tool call(s)`
        );

        for (const [toolCallId, { toolName }] of this.pendingToolCalls) {
            const syntheticResult: SanitizedToolResult = {
                content: [{ type: 'text', text: options.resultText }],
                meta: {
                    toolName,
                    toolCallId,
                    success: false,
                },
            };

            await this.contextManager.addToolResult(
                toolCallId,
                toolName,
                syntheticResult,
                undefined
            );

            // Emit tool-result event so CLI/WebUI can update UI
            this.eventBus.emit('llm:tool-result', {
                toolName,
                callId: toolCallId,
                success: false,
                error: options.errorMessage,
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
