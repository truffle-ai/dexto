/**
 * StreamProcessor - Handles ALL persistence via stream events.
 *
 * According to complete-context-management-plan.md:
 * - StreamProcessor has direct ContextManager access
 * - ALL persistence happens here via stream events
 * - Execute callback is minimal (just runs tool)
 *
 * Event handling:
 * - text-delta: emit llm:chunk
 * - tool-call: emit llm:tool-call
 * - tool-result: sanitize, persist, truncate, emit llm:tool-result
 * - finish-step: add assistant message, capture tokens
 *
 * @see /complete-context-management-plan.md
 */

import type { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import type { ContextManager } from '../../context/manager.js';
import type { SessionEventBus } from '../../events/index.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { StepUsage } from './turn-executor.js';
import { truncateToolResult } from './strategies/tool-output-truncator.js';

/**
 * Configuration for StreamProcessor.
 */
export interface StreamProcessorConfig {
    /** Context manager for persistence */
    contextManager: ContextManager<unknown>;

    /** Session event bus for UI events */
    sessionEventBus: SessionEventBus;

    /** Session ID for context */
    sessionId: string;

    /** Logger instance */
    logger: IDextoLogger;
}

/**
 * Result from processing a stream.
 */
export interface StreamProcessorResult {
    /** Accumulated text from this step */
    text: string;

    /** Accumulated reasoning text */
    reasoning?: string;

    /** Finish reason from the step */
    finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error';

    /** Token usage */
    usage: StepUsage;

    /** Whether any tool calls were made */
    hasToolCalls: boolean;

    /** Tool calls made during this step */
    toolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
}

/**
 * StreamProcessor handles stream events and owns ALL persistence.
 *
 * Key design from plan:
 * - Has direct ContextManager access
 * - ALL persistence happens in event handlers
 * - Execute callback just runs tool, returns raw result
 */
export class StreamProcessor {
    private readonly contextManager: ContextManager<unknown>;
    private readonly sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private readonly logger: IDextoLogger;

    constructor(config: StreamProcessorConfig) {
        this.contextManager = config.contextManager;
        this.sessionEventBus = config.sessionEventBus;
        this.sessionId = config.sessionId;
        this.logger = config.logger.createChild(DextoLogComponent.CONTEXT);
    }

    /**
     * Process a stream from streamText.
     *
     * Takes a function that returns the stream (lazy evaluation).
     * Handles all persistence via stream events.
     *
     * @param streamFn Function that creates the stream
     * @param signal Abort signal for cancellation
     * @returns Result with text, usage, tool calls
     */
    async process(
        streamFn: () => StreamTextResult<VercelToolSet, unknown>,
        signal?: AbortSignal
    ): Promise<StreamProcessorResult> {
        // Accumulated state
        let text = '';
        let reasoning = '';
        let finishReason: StreamProcessorResult['finishReason'] = 'stop';
        let usage: StepUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        const toolCalls: StreamProcessorResult['toolCalls'] = [];
        const toolResults = new Map<string, unknown>();

        // Create the stream
        const stream = streamFn();

        try {
            // Process fullStream events
            for await (const event of stream.fullStream) {
                // Check for abort
                if (signal?.aborted) {
                    this.logger.debug('StreamProcessor: Aborted during processing');
                    finishReason = 'stop';
                    break;
                }

                switch (event.type) {
                    case 'text-delta': {
                        text += event.text;
                        this.sessionEventBus.emit('llm:chunk', {
                            chunkType: 'text',
                            content: event.text,
                            isComplete: false,
                        });
                        break;
                    }

                    case 'reasoning-delta': {
                        // Reasoning delta events
                        reasoning += event.text;
                        this.sessionEventBus.emit('llm:chunk', {
                            chunkType: 'reasoning',
                            content: event.text,
                            isComplete: false,
                        });
                        break;
                    }

                    case 'tool-call': {
                        this.logger.debug(
                            `StreamProcessor: Tool call - ${event.toolName} (${event.toolCallId})`
                        );
                        const args = event.input as Record<string, unknown>;
                        toolCalls.push({
                            id: event.toolCallId,
                            name: event.toolName,
                            args,
                        });
                        this.sessionEventBus.emit('llm:tool-call', {
                            toolName: event.toolName,
                            args,
                            callId: event.toolCallId,
                        });
                        break;
                    }

                    case 'tool-result': {
                        // ALL PERSISTENCE HAPPENS HERE
                        this.logger.debug(
                            `StreamProcessor: Tool result - ${event.toolName} (${event.toolCallId})`
                        );

                        // Store raw result for later (used in assistant message)
                        const rawResult = event.output;
                        toolResults.set(event.toolCallId, rawResult);

                        // Truncate oversized outputs at source
                        const { result: truncatedResult, truncated } = truncateToolResult(
                            rawResult,
                            event.toolName
                        );
                        if (truncated) {
                            this.logger.debug(
                                `StreamProcessor: Truncated output for ${event.toolName}`
                            );
                        }

                        // Persist to context manager (handles sanitization & blob storage)
                        const persisted = await this.contextManager.addToolResult(
                            event.toolCallId,
                            event.toolName,
                            truncatedResult,
                            { success: true }
                        );

                        // Emit event for UI
                        this.sessionEventBus.emit('llm:tool-result', {
                            toolName: event.toolName,
                            callId: event.toolCallId,
                            success: true,
                            sanitized: persisted,
                        });
                        break;
                    }

                    case 'error': {
                        this.logger.error(`StreamProcessor: Error event - ${event.error}`);
                        finishReason = 'error';
                        break;
                    }

                    case 'finish-step': {
                        this.logger.debug(
                            `StreamProcessor: Step finished - reason: ${event.finishReason}`
                        );

                        // Capture finish reason directly (no pointless mapping)
                        finishReason = event.finishReason as StreamProcessorResult['finishReason'];

                        // Capture token usage
                        if (event.usage) {
                            const inputTokens = event.usage.inputTokens ?? 0;
                            const outputTokens = event.usage.outputTokens ?? 0;
                            usage = {
                                inputTokens,
                                outputTokens,
                                totalTokens: inputTokens + outputTokens,
                            };
                        }

                        // Add assistant message with tool calls
                        if (toolCalls.length > 0) {
                            const formattedToolCalls = toolCalls.map((tc) => ({
                                id: tc.id,
                                type: 'function' as const,
                                function: {
                                    name: tc.name,
                                    arguments: JSON.stringify(tc.args),
                                },
                            }));
                            await this.contextManager.addAssistantMessage(
                                text || null,
                                formattedToolCalls
                            );
                        } else if (text) {
                            // No tool calls, just text response
                            await this.contextManager.addAssistantMessage(text, undefined);
                        }
                        break;
                    }

                    // Ignore informational events
                    case 'start':
                    case 'finish':
                        break;

                    default:
                        // Log unknown events for debugging
                        this.logger.debug(
                            `StreamProcessor: Unknown event type: ${(event as { type: string }).type}`
                        );
                }
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                this.logger.debug('StreamProcessor: Stream aborted');
                finishReason = 'stop';
            } else {
                this.logger.error(`StreamProcessor: Error processing stream: ${String(error)}`);
                finishReason = 'error';
            }
        }

        // Emit final response event
        this.sessionEventBus.emit('llm:response', {
            content: text,
            ...(reasoning && { reasoning }),
            tokenUsage: {
                ...(usage.inputTokens && { inputTokens: usage.inputTokens }),
                ...(usage.outputTokens && { outputTokens: usage.outputTokens }),
                ...(usage.totalTokens && { totalTokens: usage.totalTokens }),
            },
        });

        const result: StreamProcessorResult = {
            text,
            finishReason,
            usage,
            hasToolCalls: toolCalls.length > 0,
            toolCalls,
        };

        if (reasoning) {
            result.reasoning = reasoning;
        }

        return result;
    }
}
