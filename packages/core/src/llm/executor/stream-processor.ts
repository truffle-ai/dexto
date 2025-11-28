import { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { ContextManager } from '../../context/manager.js';
import { SessionEventBus } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { truncateToolResult } from './tool-output-truncator.js';
import { StreamProcessorResult } from './types.js';
import { sanitizeToolResult } from '../../context/utils.js';
import { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { LLMProvider, LLMRouter } from '../types.js';

export interface StreamProcessorConfig {
    provider: LLMProvider;
    model: string;
    router: LLMRouter;
}

export class StreamProcessor {
    private assistantMessageId: string | null = null;
    private actualTokens: import('../types.js').TokenUsage | null = null;
    private finishReason: string = 'unknown';
    private reasoningText: string = '';
    private accumulatedText: string = '';
    private logger: IDextoLogger;

    /**
     * @param contextManager Context manager for message persistence
     * @param eventBus Event bus for emitting events
     * @param resourceManager Resource manager for blob storage
     * @param abortSignal Abort signal for cancellation
     * @param config Provider/model configuration
     * @param logger Logger instance
     * @param streaming If true, emits llm:chunk events. Default true.
     */
    constructor(
        private contextManager: ContextManager,
        private eventBus: SessionEventBus,
        private resourceManager: ResourceManager,
        private abortSignal: AbortSignal,
        private config: StreamProcessorConfig,
        logger: IDextoLogger,
        private streaming: boolean = true
    ) {
        this.logger = logger.createChild(DextoLogComponent.EXECUTOR);
    }

    async process(
        streamFn: () => StreamTextResult<VercelToolSet, unknown>
    ): Promise<StreamProcessorResult> {
        const stream = streamFn();

        try {
            for await (const event of stream.fullStream) {
                this.abortSignal.throwIfAborted();

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

                        // Only emit chunks in streaming mode
                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'reasoning',
                                content: event.text,
                            });
                        }
                        break;

                    case 'tool-call':
                        // Create tool call record
                        if (!this.assistantMessageId) {
                            this.assistantMessageId = await this.createAssistantMessage();
                        }

                        await this.contextManager.addToolCall(this.assistantMessageId!, {
                            id: event.toolCallId,
                            type: 'function',
                            function: {
                                name: event.toolName,
                                arguments: JSON.stringify(event.input),
                            },
                        });

                        this.eventBus.emit('llm:tool-call', {
                            toolName: event.toolName,
                            args: event.input as Record<string, unknown>,
                            callId: event.toolCallId,
                        });
                        break;

                    case 'tool-result':
                        // PERSISTENCE HAPPENS HERE
                        const rawResult = event.output;

                        // Sanitize
                        const sanitized = await sanitizeToolResult(
                            rawResult,
                            {
                                blobStore: this.resourceManager.getBlobStore(),
                                toolName: event.toolName,
                                toolCallId: event.toolCallId,
                            },
                            this.logger
                        );

                        // Truncate
                        const truncated = truncateToolResult(sanitized);

                        // Persist to history
                        await this.contextManager.addToolResult(
                            event.toolCallId,
                            event.toolName,
                            truncated // We pass the sanitized & truncated result
                        );

                        this.eventBus.emit('llm:tool-result', {
                            toolName: event.toolName,
                            callId: event.toolCallId,
                            success: true,
                            sanitized: truncated,
                            rawResult: rawResult,
                        });
                        break;

                    case 'finish':
                        this.finishReason = event.finishReason;
                        const usage = {
                            inputTokens: event.totalUsage.inputTokens ?? 0,
                            outputTokens: event.totalUsage.outputTokens ?? 0,
                            totalTokens: event.totalUsage.totalTokens ?? 0,
                            // Capture reasoning tokens if available (from Claude extended thinking, etc.)
                            ...(event.totalUsage.reasoningTokens !== undefined && {
                                reasoningTokens: event.totalUsage.reasoningTokens,
                            }),
                        };
                        this.actualTokens = usage;

                        // Finalize assistant message with usage
                        if (this.assistantMessageId) {
                            await this.contextManager.updateAssistantMessage(
                                this.assistantMessageId,
                                {
                                    tokenUsage: usage,
                                }
                            );
                        }

                        this.eventBus.emit('llm:response', {
                            content: '', // Content already streamed via chunks
                            ...(this.reasoningText && { reasoning: this.reasoningText }),
                            provider: this.config.provider,
                            model: this.config.model,
                            router: this.config.router,
                            tokenUsage: usage,
                        });
                        break;

                    case 'error':
                        this.eventBus.emit('llm:error', {
                            error:
                                event.error instanceof Error
                                    ? event.error
                                    : new Error(String(event.error)),
                        });
                        break;
                }
            }
        } catch (error) {
            this.logger.error('Stream processing failed', { error });
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
}
