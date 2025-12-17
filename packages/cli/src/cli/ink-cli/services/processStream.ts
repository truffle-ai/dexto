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
import { appendFileSync, writeFileSync } from 'fs';
import type { StreamingEvent, SanitizedToolResult } from '@dexto/core';
import { ApprovalType as ApprovalTypeEnum, ApprovalStatus } from '@dexto/core';
import type { Message, UIState, ToolStatus } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { checkForSplit } from '../utils/streamSplitter.js';
import { getToolDisplayName, formatToolArgsForDisplay } from '../utils/messageFormatting.js';
import { isEditWriteTool } from '../utils/toolUtils.js';

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
    /** Setter for current approval request (for approval UI) */
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    /** Setter for approval queue (for queued approvals) */
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
}

/**
 * Options for processStream
 */
export interface ProcessStreamOptions {
    /** Whether to stream chunks (true) or wait for complete response (false). Default: true */
    useStreaming?: boolean;
    /** Ref to check if "accept all edits" mode is enabled (reads .current for latest value) */
    autoApproveEditsRef: { current: boolean };
    /** Event bus for emitting auto-approval responses */
    eventBus: import('@dexto/core').AgentEventBus;
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
    /** Flag to track if text was finalized early (before tools) to avoid duplication */
    textFinalizedBeforeTool: boolean;
    /**
     * Accumulated text in non-streaming mode.
     * In non-streaming mode, we don't update UI on each chunk, but we need to track
     * the text so we can add it BEFORE tool calls for correct message ordering.
     */
    nonStreamingAccumulatedText: string;
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
 * @param options - Configuration options
 */
export async function processStream(
    iterator: AsyncIterableIterator<StreamingEvent>,
    setters: ProcessStreamSetters,
    options: ProcessStreamOptions
): Promise<void> {
    const {
        setMessages,
        setPendingMessages,
        setDequeuedBuffer,
        setUi,
        setQueuedMessages,
        setApproval,
        setApprovalQueue,
    } = setters;
    const useStreaming = options?.useStreaming ?? true;

    // Track streaming state (synchronous, not React state)
    const state: StreamState = {
        messageId: null,
        content: '',
        outputTokens: 0,
        finalizedContent: '',
        splitCounter: 0,
        textFinalizedBeforeTool: false,
        nonStreamingAccumulatedText: '',
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
     * Update toolStatus for a pending message by ID
     * Used for tool status transitions: pending → pending_approval → running → finished
     */
    const updatePendingStatus = (messageId: string, status: ToolStatus) => {
        localPending = localPending.map((msg) =>
            msg.id === messageId ? { ...msg, toolStatus: status } : msg
        );
        setPendingMessages(localPending);
    };

    /**
     * Progressive finalization: split large streaming content at safe markdown
     * boundaries and move completed portions to Static to reduce flickering.
     *
     * Safe to use with message queueing because dequeued user messages are
     * rendered in a separate buffer AFTER pendingMessages, guaranteeing
     * correct visual order regardless of React batching timing.
     *
     * RACE CONDITION FIX: We clear the pending message content BEFORE adding
     * the split, then restore with afterContent. This ensures any intermediate
     * render sees empty pending (not stale full content), avoiding duplication.
     */
    const progressiveFinalize = (content: string): string => {
        const splitResult = checkForSplit(content);

        if (splitResult.shouldSplit && splitResult.before && splitResult.after !== undefined) {
            // Add the completed portion directly to finalized messages
            state.splitCounter++;
            const splitId = `${state.messageId}-split-${state.splitCounter}`;
            const beforeContent = splitResult.before;
            const afterContent = splitResult.after;
            const isFirstSplit = state.splitCounter === 1;

            // STEP 1: Clear pending message content to avoid showing stale content
            // during React's batched render cycle
            if (state.messageId) {
                localPending = localPending.map((m) =>
                    m.id === state.messageId ? { ...m, content: '', isContinuation: true } : m
                );
                setPendingMessages(localPending);
            }

            // STEP 2: Add split message to finalized
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

            // STEP 3: Restore pending with afterContent
            if (state.messageId) {
                localPending = localPending.map((m) =>
                    m.id === state.messageId ? { ...m, content: afterContent } : m
                );
                setPendingMessages(localPending);
            }

            // Track total finalized content for final message assembly
            state.finalizedContent += beforeContent;

            // Return only the remaining content for pending
            return afterContent;
        }

        return content;
    };

    // DEBUG: Track event order and content - writes to /tmp/dexto-stream-debug.log
    const DEBUG_STREAM = false;
    const debugLog = (msg: string, data?: Record<string, unknown>) => {
        if (DEBUG_STREAM) {
            const timestamp = new Date().toISOString().split('T')[1];
            const line = `[${timestamp}] ${msg} ${data ? JSON.stringify(data) : ''}\n`;
            appendFileSync('/tmp/dexto-stream-debug.log', line);
        }
    };

    // Clear log file and log initial config
    if (DEBUG_STREAM) {
        writeFileSync(
            '/tmp/dexto-stream-debug.log',
            `=== NEW STREAM ${new Date().toISOString()} ===\n`
        );
        debugLog('CONFIG', { useStreaming });
    }

    try {
        for await (const event of iterator) {
            debugLog(`EVENT: ${event.name}`, {
                ...(event.name === 'llm:chunk' && {
                    chunkType: (event as any).chunkType,
                    contentLen: (event as any).content?.length,
                }),
                ...(event.name === 'llm:tool-call' && { toolName: (event as any).toolName }),
            });

            switch (event.name) {
                case 'llm:thinking': {
                    debugLog('THINKING: resetting state', {
                        prevMessageId: state.messageId,
                        prevContentLen: state.content.length,
                    });
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
                    state.textFinalizedBeforeTool = false;
                    state.nonStreamingAccumulatedText = '';
                    break;
                }

                case 'llm:chunk': {
                    // In non-streaming mode, accumulate text but don't update UI
                    // We need to track text so we can add it BEFORE tool calls (ordering fix)
                    if (!useStreaming) {
                        if (event.chunkType === 'text') {
                            state.nonStreamingAccumulatedText += event.content;
                            debugLog('CHUNK (non-stream): accumulated', {
                                chunkLen: event.content?.length,
                                totalLen: state.nonStreamingAccumulatedText.length,
                                preview: state.nonStreamingAccumulatedText.slice(0, 50),
                            });
                        }
                        break;
                    }

                    // End thinking state when first chunk arrives
                    setUi((prev) => ({ ...prev, isThinking: false }));

                    if (event.chunkType === 'text') {
                        debugLog('CHUNK (stream): text', {
                            hasMessageId: !!state.messageId,
                            chunkLen: event.content?.length,
                            currentContentLen: state.content.length,
                            preview: event.content?.slice(0, 30),
                        });
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
                            // progressiveFinalize updates pending message internally when split occurs
                            const pendingContent = progressiveFinalize(state.content);
                            const splitOccurred = pendingContent !== state.content;

                            // Update state with remaining content
                            state.content = pendingContent;

                            // Only update pending if no split occurred (split already handled by progressiveFinalize)
                            if (!splitOccurred) {
                                const messageId = state.messageId;
                                // Mark as continuation if we've had any splits
                                const isContinuation = state.splitCounter > 0;
                                updatePending(messageId, {
                                    content: pendingContent,
                                    isContinuation,
                                });
                            }
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
                    } else if (finalContent && !state.textFinalizedBeforeTool) {
                        // No streaming message exists - add directly to finalized
                        // This handles: non-streaming mode, or multi-step turns after tool calls
                        // Skip if text was already finalized before tools (avoid duplication)
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
                    // Reset the flag for this response (new text after tools will create new message)
                    state.textFinalizedBeforeTool = false;
                    break;
                }

                case 'llm:tool-call': {
                    debugLog('TOOL-CALL: state check', {
                        toolName: event.toolName,
                        hasMessageId: !!state.messageId,
                        contentLen: state.content.length,
                        nonStreamAccumLen: state.nonStreamingAccumulatedText.length,
                        contentPreview: state.content.slice(0, 50),
                        nonStreamPreview: state.nonStreamingAccumulatedText.slice(0, 50),
                        useStreaming,
                    });
                    // ORDERING FIX: Add any accumulated text BEFORE adding tool
                    // This ensures text appears before tools in the message list.

                    // Streaming mode: handle pending assistant message before tool
                    if (state.messageId) {
                        if (state.content) {
                            // Finalize pending message with content
                            const messageId = state.messageId;
                            const content = state.content;
                            const isContinuation = state.splitCounter > 0;
                            debugLog('TOOL-CALL: finalizing pending message', {
                                messageId,
                                contentLen: content.length,
                            });
                            finalizeMessage(messageId, {
                                content,
                                isStreaming: false,
                                isContinuation,
                            });
                            // Mark that we finalized text early - prevents duplicate in llm:response
                            state.textFinalizedBeforeTool = true;
                        } else {
                            // Empty pending message (first chunk had no content) - remove it
                            // This prevents empty bullets when LLM/SDK sends empty initial chunk
                            debugLog('TOOL-CALL: removing empty pending message', {
                                messageId: state.messageId,
                            });
                            removeFromPending(state.messageId);
                        }
                        state.messageId = null;
                        state.content = '';
                    } else {
                        debugLog('TOOL-CALL: no pending message to finalize');
                    }

                    // Non-streaming mode: add accumulated text as finalized message
                    if (!useStreaming && state.nonStreamingAccumulatedText) {
                        debugLog('TOOL-CALL: adding non-stream accumulated text', {
                            len: state.nonStreamingAccumulatedText.length,
                        });
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('assistant'),
                                role: 'assistant',
                                content: state.nonStreamingAccumulatedText,
                                timestamp: new Date(),
                                isStreaming: false,
                            },
                        ]);
                        state.nonStreamingAccumulatedText = '';
                        // Mark that we finalized text early - prevents duplicate in llm:response
                        state.textFinalizedBeforeTool = true;
                    }

                    const toolMessageId = event.callId
                        ? `tool-${event.callId}`
                        : generateMessageId('tool');

                    // Get friendly display name and format args
                    const displayName = getToolDisplayName(event.toolName);
                    const argsFormatted = formatToolArgsForDisplay(
                        event.toolName,
                        event.args || {}
                    );

                    // Format: ToolName(args)
                    const toolContent = argsFormatted
                        ? `${displayName}(${argsFormatted})`
                        : displayName;

                    // Tool calls start in 'pending' state (don't know if approval needed yet)
                    // Status transitions: pending → pending_approval (if approval needed) → running → finished
                    // Or for pre-approved: pending → running → finished
                    addToPending({
                        id: toolMessageId,
                        role: 'tool',
                        content: toolContent,
                        timestamp: new Date(),
                        toolStatus: 'pending',
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
                    // Add error message to finalized
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${event.error.message}`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Only stop processing for non-recoverable errors (fatal)
                    // Tool errors are recoverable - agent continues after them
                    if (event.recoverable !== true) {
                        // Cancel any streaming message in pending
                        if (state.messageId) {
                            removeFromPending(state.messageId);
                            state.messageId = null;
                            state.content = '';
                        }

                        // Clear any remaining pending messages
                        clearPending();

                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                        }));
                    }
                    break;
                }

                case 'run:complete': {
                    const { durationMs } = event;
                    const { outputTokens } = state;

                    // Ensure any remaining pending messages are finalized
                    finalizeAllPending();

                    // Add run summary message at the END (not inserted in middle)
                    // IMPORTANT: Ink's <Static> tracks rendered items by array position, not key.
                    // Inserting in the middle shifts existing items, causing them to re-render.
                    // Always append to avoid duplicate rendering.
                    if (durationMs > 0 || outputTokens > 0) {
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

                        setMessages((prev) => [...prev, summaryMessage]);
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

                case 'tool:running': {
                    // Tool execution actually started (after approval if needed)
                    // Update status from 'pending' or 'pending_approval' to 'running'
                    const runningToolId = `tool-${event.toolCallId}`;
                    updatePendingStatus(runningToolId, 'running');
                    break;
                }

                case 'approval:request': {
                    // Handle approval requests in processStream (NOT useAgentEvents) to ensure
                    // proper ordering - text messages must be added BEFORE approval UI shows.
                    // This fixes a race condition where direct event bus subscription in
                    // useAgentEvents fired before the iterator processed llm:tool-call.

                    // Check for auto-approval of edit/write tools FIRST
                    // Read from ref to get latest value (may have changed mid-stream)
                    const autoApproveEdits = options.autoApproveEditsRef.current;
                    const { eventBus } = options;

                    if (autoApproveEdits && event.type === ApprovalTypeEnum.TOOL_CONFIRMATION) {
                        // Type is narrowed - metadata is now ToolConfirmationMetadata
                        const { toolName } = event.metadata;

                        if (isEditWriteTool(toolName)) {
                            // Auto-approve immediately - emit response and let tool:running handle status
                            eventBus.emit('approval:response', {
                                approvalId: event.approvalId,
                                status: ApprovalStatus.APPROVED,
                                sessionId: event.sessionId,
                                data: {},
                            });
                            break;
                        }
                    }

                    // Manual approval needed - update tool status to 'pending_approval'
                    // Extract toolCallId based on approval type
                    const toolCallId =
                        event.type === ApprovalTypeEnum.TOOL_CONFIRMATION
                            ? event.metadata.toolCallId
                            : undefined;
                    if (toolCallId) {
                        updatePendingStatus(`tool-${toolCallId}`, 'pending_approval');
                    }

                    // Show approval UI (moved from useAgentEvents for ordering)
                    if (
                        event.type === ApprovalTypeEnum.TOOL_CONFIRMATION ||
                        event.type === ApprovalTypeEnum.COMMAND_CONFIRMATION ||
                        event.type === ApprovalTypeEnum.ELICITATION
                    ) {
                        const newApproval: ApprovalRequest = {
                            approvalId: event.approvalId,
                            type: event.type,
                            timestamp: event.timestamp,
                            metadata: event.metadata,
                        };

                        if (event.sessionId !== undefined) {
                            newApproval.sessionId = event.sessionId;
                        }
                        if (event.timeout !== undefined) {
                            newApproval.timeout = event.timeout;
                        }

                        // Queue if there's already an approval, otherwise show immediately
                        setApproval((current) => {
                            if (current !== null) {
                                setApprovalQueue((queue) => [...queue, newApproval]);
                                return current;
                            }
                            setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                            return newApproval;
                        });
                    }
                    break;
                }

                // Ignore other events (approval UI handled by useAgentEvents)
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
