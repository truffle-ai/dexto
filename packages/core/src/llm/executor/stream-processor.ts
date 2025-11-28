/**
 * StreamProcessor - Handles stream events and manages persistence.
 *
 * Processes the fullStream from Vercel AI SDK, handling:
 * - Text deltas (assistant response streaming)
 * - Tool calls and results
 * - Token usage capture
 * - Event emission for UI updates
 *
 * Key design: StreamProcessor handles ALL persistence to ensure correct ordering.
 * Stream events arrive in order: text-delta → tool-call → tool-result → finish-step
 *
 * @see /complete-context-management-plan.md
 */

import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { StepResult, StepUsage } from './turn-executor.js';

/**
 * Stream event types from Vercel AI SDK fullStream.
 */
export type StreamEventType =
    | 'text-start'
    | 'text-delta'
    | 'reasoning-delta'
    | 'tool-call'
    | 'tool-call-streaming-start'
    | 'tool-call-delta'
    | 'tool-result'
    | 'error'
    | 'finish-message'
    | 'finish-step';

/**
 * Base stream event structure.
 */
export interface StreamEvent {
    type: StreamEventType;
}

/**
 * Text delta event.
 */
export interface TextDeltaEvent extends StreamEvent {
    type: 'text-delta';
    text: string;
}

/**
 * Reasoning delta event (for models with reasoning).
 */
export interface ReasoningDeltaEvent extends StreamEvent {
    type: 'reasoning-delta';
    text: string;
}

/**
 * Tool call event.
 */
export interface ToolCallEvent extends StreamEvent {
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

/**
 * Tool result event.
 */
export interface ToolResultEvent extends StreamEvent {
    type: 'tool-result';
    toolCallId: string;
    toolName: string;
    result: unknown;
}

/**
 * Error event.
 */
export interface ErrorEvent extends StreamEvent {
    type: 'error';
    error: Error;
}

/**
 * Finish step event with usage.
 */
export interface FinishStepEvent extends StreamEvent {
    type: 'finish-step';
    finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error';
    usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        totalTokens: number;
    };
}

/**
 * Union of all event types.
 */
export type FullStreamEvent =
    | StreamEvent
    | TextDeltaEvent
    | ReasoningDeltaEvent
    | ToolCallEvent
    | ToolResultEvent
    | ErrorEvent
    | FinishStepEvent;

/**
 * Event handlers for stream processing.
 */
export interface StreamEventHandlers {
    /** Called when text streaming starts */
    onTextStart?: () => void | Promise<void>;

    /** Called for each text chunk */
    onTextDelta?: (text: string) => void | Promise<void>;

    /** Called for each reasoning chunk */
    onReasoningDelta?: (text: string) => void | Promise<void>;

    /** Called when a tool is called */
    onToolCall?: (
        toolCallId: string,
        toolName: string,
        args: Record<string, unknown>
    ) => void | Promise<void>;

    /** Called when a tool returns a result */
    onToolResult?: (toolCallId: string, toolName: string, result: unknown) => void | Promise<void>;

    /** Called on error */
    onError?: (error: Error) => void | Promise<void>;

    /** Called when step finishes */
    onStepFinish?: (finishReason: string, usage: StepUsage) => void | Promise<void>;
}

/**
 * Result from processing a stream.
 */
export interface StreamProcessorResult {
    /** Accumulated text from this step */
    text: string;

    /** Accumulated reasoning text */
    reasoning: string;

    /** Finish reason from the step */
    finishReason: StepResult['finishReason'];

    /** Token usage */
    usage: StepUsage;

    /** Tool calls made during this step */
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;

    /** Whether any tool calls were made */
    hasToolCalls: boolean;
}

/**
 * StreamProcessor handles the fullStream from Vercel AI SDK.
 *
 * It accumulates text, tracks tool calls, and invokes handlers for each event.
 * The handlers can be used to:
 * - Persist messages to history
 * - Emit events for UI updates
 * - Process tool results
 */
export class StreamProcessor {
    private readonly logger: IDextoLogger;
    private readonly handlers: StreamEventHandlers;
    private readonly abortSignal: AbortSignal | undefined;

    // Accumulated state during processing
    private text: string = '';
    private reasoning: string = '';
    private toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    private finishReason: StepResult['finishReason'] = 'stop';
    private usage: StepUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    constructor(handlers: StreamEventHandlers, logger: IDextoLogger, abortSignal?: AbortSignal) {
        this.handlers = handlers;
        this.logger = logger.createChild(DextoLogComponent.CONTEXT);
        this.abortSignal = abortSignal;
    }

    /**
     * Process a stream of events.
     *
     * @param stream AsyncIterable of stream events
     * @returns Accumulated result from the stream
     */
    async process(stream: AsyncIterable<FullStreamEvent>): Promise<StreamProcessorResult> {
        this.reset();

        try {
            for await (const event of stream) {
                // Check for abort
                if (this.abortSignal?.aborted) {
                    this.logger.debug('StreamProcessor: Aborted during processing');
                    this.finishReason = 'stop';
                    break;
                }

                await this.handleEvent(event);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                this.logger.debug('StreamProcessor: Stream aborted');
                this.finishReason = 'stop';
            } else {
                this.logger.error(`StreamProcessor: Error processing stream: ${String(error)}`);
                this.finishReason = 'error';
                if (this.handlers.onError && error instanceof Error) {
                    await this.handlers.onError(error);
                }
            }
        }

        return {
            text: this.text,
            reasoning: this.reasoning,
            finishReason: this.finishReason,
            usage: this.usage,
            toolCalls: this.toolCalls,
            hasToolCalls: this.toolCalls.length > 0,
        };
    }

    /**
     * Handle a single stream event.
     */
    private async handleEvent(event: FullStreamEvent): Promise<void> {
        switch (event.type) {
            case 'text-start':
                this.logger.debug('StreamProcessor: Text started');
                if (this.handlers.onTextStart) {
                    await this.handlers.onTextStart();
                }
                break;

            case 'text-delta': {
                const textEvent = event as TextDeltaEvent;
                this.text += textEvent.text;
                if (this.handlers.onTextDelta) {
                    await this.handlers.onTextDelta(textEvent.text);
                }
                break;
            }

            case 'reasoning-delta': {
                const reasoningEvent = event as ReasoningDeltaEvent;
                this.reasoning += reasoningEvent.text;
                if (this.handlers.onReasoningDelta) {
                    await this.handlers.onReasoningDelta(reasoningEvent.text);
                }
                break;
            }

            case 'tool-call': {
                const toolEvent = event as ToolCallEvent;
                this.logger.debug(
                    `StreamProcessor: Tool call - ${toolEvent.toolName} (${toolEvent.toolCallId})`
                );
                this.toolCalls.push({
                    id: toolEvent.toolCallId,
                    name: toolEvent.toolName,
                    args: toolEvent.args,
                });
                if (this.handlers.onToolCall) {
                    await this.handlers.onToolCall(
                        toolEvent.toolCallId,
                        toolEvent.toolName,
                        toolEvent.args
                    );
                }
                break;
            }

            case 'tool-result': {
                const resultEvent = event as ToolResultEvent;
                this.logger.debug(
                    `StreamProcessor: Tool result - ${resultEvent.toolName} (${resultEvent.toolCallId})`
                );
                if (this.handlers.onToolResult) {
                    await this.handlers.onToolResult(
                        resultEvent.toolCallId,
                        resultEvent.toolName,
                        resultEvent.result
                    );
                }
                break;
            }

            case 'error': {
                const errorEvent = event as ErrorEvent;
                this.logger.error(`StreamProcessor: Error event - ${errorEvent.error.message}`);
                this.finishReason = 'error';
                if (this.handlers.onError) {
                    await this.handlers.onError(errorEvent.error);
                }
                break;
            }

            case 'finish-step': {
                const finishEvent = event as FinishStepEvent;
                this.logger.debug(
                    `StreamProcessor: Step finished - reason: ${finishEvent.finishReason}, ` +
                        `tokens: ${finishEvent.usage.inputTokens} in, ${finishEvent.usage.outputTokens} out`
                );
                this.finishReason = finishEvent.finishReason;
                this.usage = {
                    inputTokens: finishEvent.usage.inputTokens,
                    outputTokens: finishEvent.usage.outputTokens,
                    totalTokens: finishEvent.usage.totalTokens,
                };
                // Only include reasoningTokens if present (exactOptionalPropertyTypes)
                if (finishEvent.usage.reasoningTokens !== undefined) {
                    this.usage.reasoningTokens = finishEvent.usage.reasoningTokens;
                }
                if (this.handlers.onStepFinish) {
                    await this.handlers.onStepFinish(finishEvent.finishReason, this.usage);
                }
                break;
            }

            case 'tool-call-streaming-start':
            case 'tool-call-delta':
            case 'finish-message':
                // These events are informational, no action needed
                this.logger.debug(`StreamProcessor: Ignoring event type: ${event.type}`);
                break;

            default: {
                // Handle any unknown event types gracefully
                const unknownEvent = event as StreamEvent;
                this.logger.debug(`StreamProcessor: Unknown event type: ${unknownEvent.type}`);
            }
        }
    }

    /**
     * Reset state for processing a new stream.
     */
    private reset(): void {
        this.text = '';
        this.reasoning = '';
        this.toolCalls = [];
        this.finishReason = 'stop';
        this.usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    }
}
