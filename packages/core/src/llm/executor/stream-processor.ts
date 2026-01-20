import { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { ContextManager } from '../../context/manager.js';
import { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { truncateToolResult } from './tool-output-truncator.js';
import { StreamProcessorResult } from './types.js';
import { sanitizeToolResult } from '../../context/utils.js';
import type { SanitizedToolResult } from '../../context/types.js';
import { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { LLMProvider, TokenUsage } from '../types.js';

export interface StreamProcessorConfig {
    provider: LLMProvider;
    model: string;
    /** Estimated input tokens before LLM call (for analytics/calibration) */
    estimatedInputTokens?: number;
}

export class StreamProcessor {
    private assistantMessageId: string | null = null;
    private actualTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    private finishReason: LLMFinishReason = 'unknown';
    private reasoningText: string = '';
    private reasoningMetadata: Record<string, unknown> | undefined;
    private accumulatedText: string = '';
    private logger: IDextoLogger;
    /**
     * Track pending tool calls (added to context but no result yet).
     * On cancel/abort, we add synthetic "cancelled" results to maintain tool_use/tool_result pairing.
     */
    private pendingToolCalls: Map<string, { toolName: string }> = new Map();

    /**
     * @param contextManager Context manager for message persistence
     * @param eventBus Event bus for emitting events
     * @param resourceManager Resource manager for blob storage
     * @param abortSignal Abort signal for cancellation
     * @param config Provider/model configuration
     * @param logger Logger instance
     * @param streaming If true, emits llm:chunk events. Default true.
     * @param approvalMetadata Map of tool call IDs to approval metadata
     */
    constructor(
        private contextManager: ContextManager,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private abortSignal: AbortSignal,
        private config: StreamProcessorConfig,
        logger: IDextoLogger,
        private streaming: boolean = true,
        private approvalMetadata?: Map<
            string,
            { requireApproval: boolean; approvalStatus?: 'approved' | 'rejected' }
        >
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
    }

    async process(
        streamFn: () => StreamTextResult<VercelToolSet, unknown>
    ): Promise<StreamProcessorResult> {
        const stream = streamFn();

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
                            this.reasoningMetadata = event.providerMetadata;
                        }

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'reasoning',
                                content: event.text,
                            });
                        }
                        break;

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
                            this.config.provider === 'google' ||
                            (this.config.provider as string) === 'vertex';

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

                        // Get approval metadata for this tool call
                        const approval = this.approvalMetadata?.get(event.toolCallId);

                        // Persist to history (success status comes from truncated.meta.success)
                        await this.contextManager.addToolResult(
                            event.toolCallId,
                            event.toolName,
                            truncated, // Includes meta.success from sanitization
                            approval // Only approval metadata if present
                        );

                        this.eventBus.emit('llm:tool-result', {
                            toolName: event.toolName,
                            callId: event.toolCallId,
                            success: true,
                            sanitized: truncated,
                            rawResult: rawResult,
                            ...(approval?.requireApproval !== undefined && {
                                requireApproval: approval.requireApproval,
                            }),
                            ...(approval?.approvalStatus !== undefined && {
                                approvalStatus: approval.approvalStatus,
                            }),
                        });

                        // Clean up approval metadata after use
                        this.approvalMetadata?.delete(event.toolCallId);
                        // Remove from pending (tool completed successfully)
                        this.pendingToolCalls.delete(event.toolCallId);
                        break;
                    }

                    case 'finish-step':
                        // Track token usage from completed steps for partial runs
                        // TODO: Token usage for cancelled mid-step responses is unavailable.
                        // LLM providers only send token counts in their final response chunk.
                        // If we abort mid-stream, that chunk never arrives. The tokens are
                        // still billed by the provider, but we can't report them.
                        if (event.usage) {
                            // Extract cache tokens from provider metadata (provider-specific)
                            // Anthropic returns cache tokens in providerMetadata, not in usage
                            // Bedrock follows similar pattern for Claude models
                            const anthropicMeta = event.providerMetadata?.['anthropic'] as
                                | Record<string, number>
                                | undefined;
                            const bedrockMeta = event.providerMetadata?.['bedrock'] as
                                | { usage?: Record<string, number> }
                                | undefined;

                            const cacheWriteTokens =
                                anthropicMeta?.['cacheCreationInputTokens'] ??
                                bedrockMeta?.usage?.['cacheWriteInputTokens'] ??
                                0;

                            // Cache read tokens: Anthropic uses providerMetadata, others use usage.cachedInputTokens
                            const cacheReadTokens =
                                anthropicMeta?.['cacheReadInputTokens'] ??
                                bedrockMeta?.usage?.['cacheReadInputTokens'] ??
                                event.usage.cachedInputTokens ??
                                0;

                            // Accumulate usage across steps
                            this.actualTokens = {
                                inputTokens:
                                    (this.actualTokens.inputTokens ?? 0) +
                                    (event.usage.inputTokens ?? 0),
                                outputTokens:
                                    (this.actualTokens.outputTokens ?? 0) +
                                    (event.usage.outputTokens ?? 0),
                                totalTokens:
                                    (this.actualTokens.totalTokens ?? 0) +
                                    (event.usage.totalTokens ?? 0),
                                ...(event.usage.reasoningTokens !== undefined && {
                                    reasoningTokens:
                                        (this.actualTokens.reasoningTokens ?? 0) +
                                        event.usage.reasoningTokens,
                                }),
                                // Cache tokens
                                cacheReadTokens:
                                    (this.actualTokens.cacheReadTokens ?? 0) + cacheReadTokens,
                                cacheWriteTokens:
                                    (this.actualTokens.cacheWriteTokens ?? 0) + cacheWriteTokens,
                            };
                        }
                        break;

                    case 'finish': {
                        this.finishReason = event.finishReason;

                        // Use cache tokens accumulated from finish-step events (provider metadata)
                        // For providers without finish-step events, fall back to totalUsage.cachedInputTokens
                        const cacheReadTokens =
                            this.actualTokens.cacheReadTokens ??
                            event.totalUsage.cachedInputTokens ??
                            0;
                        const cacheWriteTokens = this.actualTokens.cacheWriteTokens ?? 0;

                        // Adjust input tokens based on provider
                        // Anthropic/Bedrock: inputTokens already excludes cached tokens
                        // Other providers: inputTokens includes cached, need to subtract
                        const providerExcludesCached =
                            this.config.provider === 'anthropic' ||
                            (this.config.provider as string) === 'bedrock';
                        const adjustedInputTokens = providerExcludesCached
                            ? (event.totalUsage.inputTokens ?? 0)
                            : (event.totalUsage.inputTokens ?? 0) - cacheReadTokens;

                        const usage = {
                            inputTokens: adjustedInputTokens,
                            outputTokens: event.totalUsage.outputTokens ?? 0,
                            totalTokens: event.totalUsage.totalTokens ?? 0,
                            // Capture reasoning tokens if available (from Claude extended thinking, etc.)
                            ...(event.totalUsage.reasoningTokens !== undefined && {
                                reasoningTokens: event.totalUsage.reasoningTokens,
                            }),
                            // Cache tokens from accumulated finish-step events or totalUsage fallback
                            cacheReadTokens,
                            cacheWriteTokens,
                        };
                        this.actualTokens = usage;

                        // Log complete LLM response for debugging
                        this.logger.info('LLM response complete', {
                            finishReason: event.finishReason,
                            contentLength: this.accumulatedText.length,
                            content: this.accumulatedText,
                            ...(this.reasoningText && {
                                reasoningLength: this.reasoningText.length,
                                reasoning: this.reasoningText,
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
