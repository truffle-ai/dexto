/**
 * Process Stream Service
 *
 * Processes the async iterator from agent.stream() and updates UI state.
 * This replaces the event bus subscriptions for streaming events,
 * providing direct, synchronous control over the streaming lifecycle.
 *
 * Architecture:
 * - Messages being streamed are tracked in `pendingMessages` (rendered dynamically)
 * - Only finalized messages are added to `messages` (rendered in <Static>)
 * - Progressive finalization: large streaming content is split at safe markdown
 *   boundaries, moving completed paragraphs to Static to reduce flickering
 * - This prevents duplicate output in static terminal mode
 *
 * IMPORTANT: React batching fix (see commit history for race condition details)
 * - We use a local `localPending` array that mirrors React state synchronously
 * - This allows us to flatten nested setState calls (which caused ordering bugs)
 * - Nested setState: inner setMessages inside setPendingMessages callback gets
 *   queued and runs AFTER other setMessages calls in the same batch
 * - Flattened: setMessages and setPendingMessages are sibling calls, processed in order
 */

import type React from 'react';
import type { StreamingEvent, SanitizedToolResult } from '@dexto/core';
import type { Message, UIState } from '../state/types.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { checkForSplit } from '../utils/streamSplitter.js';

/**
 * State setters needed by processStream
 */
export interface ProcessStreamSetters {
    /** Setter for finalized messages (rendered in <Static>) */
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Setter for pending/streaming messages (rendered dynamically outside <Static>) */
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Setter for dequeued buffer (user messages waiting to render after pending) */
    setDequeuedBuffer: React.Dispatch<React.SetStateAction<Message[]>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    /** Setter for queued messages (cleared when dequeued) */
    setQueuedMessages: React.Dispatch<React.SetStateAction<import('@dexto/core').QueuedMessage[]>>;
}

/**
 * Options for processStream
 */
export interface ProcessStreamOptions {
    /** Whether to stream chunks (true) or wait for complete response (false). Default: true */
    useStreaming?: boolean;
}

/**
 * Internal state for tracking the current streaming message
 */
interface StreamState {
    messageId: string | null;
    content: string;
    outputTokens: number;
    /** Content that has been finalized (moved to Static) */
    finalizedContent: string;
    /** Counter for generating unique IDs for split messages */
    splitCounter: number;
}

/**
 * Processes the async iterator from agent.stream() and updates UI state.
 *
 * For static mode compatibility:
 * - Streaming content goes to `pendingMessages` (rendered dynamically)
 * - Finalized content is moved to `messages` (rendered in <Static>)
 *
 * @param iterator - The async iterator from agent.stream()
 * @param setters - State setters for updating UI
 * @param options - Optional configuration
 */
export async function processStream(
    iterator: AsyncIterableIterator<StreamingEvent>,
    setters: ProcessStreamSetters,
    options?: ProcessStreamOptions
): Promise<void> {
    const { setMessages, setPendingMessages, setDequeuedBuffer, setUi, setQueuedMessages } =
        setters;
    const useStreaming = options?.useStreaming ?? true;

    // Track streaming state (synchronous, not React state)
    const state: StreamState = {
        messageId: null,
        content: '',
        outputTokens: 0,
        finalizedContent: '',
        splitCounter: 0,
    };

    // LOCAL PENDING TRACKING - mirrors React state synchronously
    // This allows us to flatten nested setState calls (which caused ordering bugs).
    // See: https://github.com/facebook/react/issues/8132 - nested setState not supported
    let localPending: Message[] = [];

    /**
     * Extract text content from ContentPart array
     */
    const extractTextContent = (content: import('@dexto/core').ContentPart[]): string => {
        return content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    };

    /**
     * Move a message from pending to finalized.
     * FLATTENED: Uses localPending to avoid nested setState (which breaks ordering).
     */
    const finalizeMessage = (messageId: string, updates: Partial<Message> = {}) => {
        const msg = localPending.find((m) => m.id === messageId);
        if (msg) {
            // Add to messages FIRST (sibling call, not nested)
            setMessages((prev) => [...prev, { ...msg, ...updates }]);
        }
        // Update local tracking
        localPending = localPending.filter((m) => m.id !== messageId);
        // Then update React state (sibling call)
        setPendingMessages(localPending);
    };

    /**
     * Move all pending messages to finalized (used at run:complete and message:dequeued).
     * FLATTENED: Uses localPending to avoid nested setState.
     */
    const finalizeAllPending = () => {
        if (localPending.length > 0) {
            // Add to messages FIRST (sibling call, not nested)
            const toFinalize = [...localPending];
            setMessages((prev) => [...prev, ...toFinalize]);
        }
        // Update local tracking
        localPending = [];
        // Then update React state (sibling call)
        setPendingMessages([]);
    };

    /**
     * Move dequeued buffer to messages (called at start of new run)
     * This ensures user messages appear in correct order after previous response
     * NOTE: This still uses nested setState but dequeuedBuffer is separate from
     * the main message flow and only flushed at llm:thinking (start of run)
     */
    const flushDequeuedBuffer = () => {
        setDequeuedBuffer((buffer) => {
            if (buffer.length > 0) {
                setMessages((prev) => [...prev, ...buffer]);
            }
            return [];
        });
    };

    /**
     * Add message to pending (updates both local tracking and React state)
     */
    const addToPending = (msg: Message) => {
        localPending = [...localPending, msg];
        setPendingMessages(localPending);
    };

    /**
     * Update a message in pending (updates both local tracking and React state)
     */
    const updatePending = (messageId: string, updates: Partial<Message>) => {
        localPending = localPending.map((m) => (m.id === messageId ? { ...m, ...updates } : m));
        setPendingMessages(localPending);
    };

    /**
     * Remove a message from pending without finalizing (updates both local and React state)
     */
    const removeFromPending = (messageId: string) => {
        localPending = localPending.filter((m) => m.id !== messageId);
        setPendingMessages(localPending);
    };

    /**
     * Clear all pending (updates both local tracking and React state)
     */
    const clearPending = () => {
        localPending = [];
        setPendingMessages([]);
    };

    /**
     * Progressive finalization: split large streaming content at safe markdown
     * boundaries and move completed portions to Static to reduce flickering.
     *
     * Safe to use with message queueing because dequeued user messages are
     * rendered in a separate buffer AFTER pendingMessages, guaranteeing
     * correct visual order regardless of React batching timing.
     */
    const progressiveFinalize = (content: string): string => {
        const splitResult = checkForSplit(content);

        if (splitResult.shouldSplit && splitResult.before && splitResult.after !== undefined) {
            // Add the completed portion directly to finalized messages
            state.splitCounter++;
            const splitId = `${state.messageId}-split-${state.splitCounter}`;
            const beforeContent = splitResult.before;
            const isFirstSplit = state.splitCounter === 1;

            setMessages((prev) => [
                ...prev,
                {
                    id: splitId,
                    role: 'assistant' as const,
                    content: beforeContent,
                    timestamp: new Date(),
                    isStreaming: false,
                    // First split shows the indicator, subsequent splits are continuations
                    isContinuation: !isFirstSplit,
                },
            ]);

            // Track total finalized content for final message assembly
            state.finalizedContent += beforeContent;

            // Return only the remaining content for pending
            return splitResult.after;
        }

        return content;
    };

    try {
        for await (const event of iterator) {
            switch (event.name) {
                case 'llm:thinking': {
                    // Flush dequeued buffer to messages at start of new run
                    // This ensures user messages appear after the previous response
                    flushDequeuedBuffer();

                    // Start thinking state, reset streaming state
                    setUi((prev) => ({ ...prev, isThinking: true }));
                    state.messageId = null;
                    state.content = '';
                    state.outputTokens = 0;
                    state.finalizedContent = '';
                    state.splitCounter = 0;
                    break;
                }

                case 'llm:chunk': {
                    // In non-streaming mode, skip chunk processing entirely
                    // We'll show the complete response when llm:response arrives
                    if (!useStreaming) break;

                    // End thinking state when first chunk arrives
                    setUi((prev) => ({ ...prev, isThinking: false }));

                    if (event.chunkType === 'text') {
                        // Create streaming message on first text chunk
                        if (!state.messageId) {
                            const newId = generateMessageId('assistant');
                            state.messageId = newId;
                            state.content = event.content;
                            state.finalizedContent = '';
                            state.splitCounter = 0;

                            // Add to PENDING (not messages) - renders dynamically
                            addToPending({
                                id: newId,
                                role: 'assistant',
                                content: event.content,
                                timestamp: new Date(),
                                isStreaming: true,
                            });
                        } else {
                            // Accumulate content
                            state.content += event.content;

                            // Check for progressive finalization (move completed paragraphs to Static)
                            const pendingContent = progressiveFinalize(state.content);

                            // Update pending message with remaining content
                            const messageId = state.messageId;
                            state.content = pendingContent;
                            // Mark as continuation if we've had any splits
                            const isContinuation = state.splitCounter > 0;

                            updatePending(messageId, { content: pendingContent, isContinuation });
                        }
                    }
                    break;
                }

                case 'llm:response': {
                    // In non-streaming mode, end thinking state when response arrives
                    // (In streaming mode, thinking ends when first chunk arrives)
                    if (!useStreaming) {
                        setUi((prev) => ({ ...prev, isThinking: false }));
                    }

                    // Accumulate token usage
                    if (event.tokenUsage?.outputTokens) {
                        state.outputTokens += event.tokenUsage.outputTokens;
                    }

                    const finalContent = event.content || '';

                    if (state.messageId) {
                        // Finalize existing streaming message (streaming mode)
                        const messageId = state.messageId;
                        const content = state.content || finalContent;

                        // Move from pending to finalized
                        finalizeMessage(messageId, { content, isStreaming: false });

                        // Reset for potential next response (multi-step)
                        state.messageId = null;
                        state.content = '';
                    } else if (finalContent) {
                        // No streaming message exists - add directly to finalized
                        // This handles: non-streaming mode, or multi-step turns after tool calls
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('assistant'),
                                role: 'assistant',
                                content: finalContent,
                                timestamp: new Date(),
                                isStreaming: false,
                            },
                        ]);
                    }
                    break;
                }

                case 'llm:tool-call': {
                    // Format args for display (compact, one-line)
                    let argsPreview = '';
                    try {
                        const argsStr = JSON.stringify(event.args);
                        const cleanArgs = argsStr.replace(/^\{|\}$/g, '').trim();
                        if (cleanArgs.length > 80) {
                            argsPreview = ` • ${cleanArgs.slice(0, 80)}...`;
                        } else if (cleanArgs.length > 0) {
                            argsPreview = ` • ${cleanArgs}`;
                        }
                    } catch {
                        argsPreview = '';
                    }

                    const toolMessageId = event.callId
                        ? `tool-${event.callId}`
                        : generateMessageId('tool');

                    // Tool calls go to PENDING (running state)
                    addToPending({
                        id: toolMessageId,
                        role: 'tool',
                        content: `${event.toolName}${argsPreview}`,
                        timestamp: new Date(),
                        toolStatus: 'running',
                    });
                    break;
                }

                case 'llm:tool-result': {
                    // Extract structured display data and content from sanitized result
                    const sanitized = event.sanitized as SanitizedToolResult | undefined;
                    const toolDisplayData = sanitized?.meta?.display;
                    const toolContent = sanitized?.content;

                    // Generate text preview for fallback display
                    let resultPreview = '';
                    try {
                        const result = event.sanitized || event.rawResult;
                        if (result) {
                            let resultStr = '';
                            if (typeof result === 'string') {
                                resultStr = result;
                            } else if (result && typeof result === 'object') {
                                const resultObj = result as {
                                    content?: unknown[];
                                    text?: string;
                                };
                                if (Array.isArray(resultObj.content)) {
                                    resultStr = resultObj.content
                                        .filter(
                                            (item): item is { type: string; text?: string } =>
                                                typeof item === 'object' &&
                                                item !== null &&
                                                'type' in item &&
                                                item.type === 'text'
                                        )
                                        .map((item) => item.text || '')
                                        .join('\n');
                                } else if (resultObj.text) {
                                    resultStr = resultObj.text;
                                } else {
                                    resultStr = JSON.stringify(result, null, 2);
                                }
                            }

                            const maxChars = 400;
                            if (resultStr.length > maxChars) {
                                resultPreview = resultStr.slice(0, maxChars) + '\n...';
                            } else {
                                resultPreview = resultStr;
                            }
                        }
                    } catch {
                        resultPreview = '';
                    }

                    if (event.callId) {
                        const toolMessageId = `tool-${event.callId}`;
                        // Finalize tool message - move to messages with result and display data
                        finalizeMessage(toolMessageId, {
                            toolResult: resultPreview,
                            toolStatus: 'finished',
                            isError: !event.success,
                            ...(toolDisplayData && { toolDisplayData }),
                            ...(toolContent && { toolContent }),
                        });
                    }
                    break;
                }

                case 'llm:error': {
                    // Cancel any streaming message in pending
                    if (state.messageId) {
                        const messageId = state.messageId;
                        removeFromPending(messageId);
                        state.messageId = null;
                        state.content = '';
                    }

                    // Add error message directly to finalized
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${event.error.message}`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Clear any remaining pending messages
                    clearPending();

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                    break;
                }

                case 'run:complete': {
                    const { durationMs } = event;
                    const { outputTokens } = state;

                    // Ensure any remaining pending messages are finalized
                    finalizeAllPending();

                    // Add run summary message before the assistant's response
                    if (durationMs > 0 || outputTokens > 0) {
                        setMessages((prev) => {
                            // Find index of the last user message
                            let lastUserIndex = -1;
                            for (let i = prev.length - 1; i >= 0; i--) {
                                if (prev[i]?.role === 'user') {
                                    lastUserIndex = i;
                                    break;
                                }
                            }

                            // Insert summary after user message (before assistant response)
                            const insertIndex = lastUserIndex + 1;
                            const summaryMessage = {
                                id: generateMessageId('summary'),
                                role: 'system' as const,
                                content: '', // Content rendered via styledType
                                timestamp: new Date(),
                                styledType: 'run-summary' as const,
                                styledData: {
                                    durationMs,
                                    outputTokens,
                                },
                            };

                            return [
                                ...prev.slice(0, insertIndex),
                                summaryMessage,
                                ...prev.slice(insertIndex),
                            ];
                        });
                    }

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                    break;
                }

                case 'message:dequeued': {
                    // Queued message is being processed
                    // NOTE: llm:thinking only fires ONCE at the start of execute(),
                    // NOT when each queued message starts. So we must finalize here.

                    // 1. Finalize any pending from previous response
                    //    This ensures the previous assistant response is in messages
                    //    before we add the next user message
                    finalizeAllPending();

                    // 2. Add user message directly to messages (not buffer)
                    //    The buffer approach doesn't work because llm:thinking
                    //    doesn't fire between queued message runs
                    const textContent = extractTextContent(event.content);

                    if (textContent || event.content.length > 0) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('user'),
                                role: 'user' as const,
                                content: textContent || '[attachment]',
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    // Clear queue state - message was consumed
                    setQueuedMessages([]);

                    // Set processing state for the queued message run
                    setUi((prev) => ({ ...prev, isProcessing: true }));
                    break;
                }

                // Ignore other events (approval:request handled by useAgentEvents)
                default:
                    break;
            }
        }
    } catch (error) {
        // Handle iterator errors (e.g., aborted)
        if (error instanceof Error && error.name === 'AbortError') {
            // Expected when cancelled, clean up UI state
            clearPending();
            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        } else {
            // Unexpected error, show to user
            clearPending();
            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('error'),
                    role: 'system',
                    content: `❌ Stream error: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp: new Date(),
                },
            ]);
            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        }
    }
}
