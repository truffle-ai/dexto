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
import { createDebugLogger } from '../utils/debugLog.js';
import { ApprovalType as ApprovalTypeEnum, ApprovalStatus } from '@dexto/core';
import type { Message, UIState, ToolStatus } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { checkForSplit } from '../utils/streamSplitter.js';
import { formatToolHeader } from '../utils/messageFormatting.js';
import { isAutoApprovableInEditMode } from '../utils/toolUtils.js';
import { capture } from '../../../analytics/index.js';
import chalk from 'chalk';

const HIDDEN_TOOL_NAMES = new Set(['wait_for']);
const normalizeToolName = (toolName: string) => {
    if (toolName.startsWith('mcp--')) {
        const trimmed = toolName.substring('mcp--'.length);
        const parts = trimmed.split('--');
        return parts.length >= 2 ? parts.slice(1).join('--') : trimmed;
    }
    if (toolName.startsWith('mcp__')) {
        const trimmed = toolName.substring('mcp__'.length);
        const parts = trimmed.split('__');
        return parts.length >= 2 ? parts.slice(1).join('__') : trimmed;
    }
    return toolName;
};
const shouldHideTool = (toolName?: string) =>
    toolName ? HIDDEN_TOOL_NAMES.has(normalizeToolName(toolName)) : false;

/**
 * Build error message with recovery guidance if available
 */
function buildErrorContent(error: unknown, prefix: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorContent = `${prefix}${errorMessage}`;

    // Add recovery guidance if available (for DextoRuntimeError)
    if (error instanceof Error && 'recovery' in error && error.recovery) {
        const recoveryMessages = Array.isArray(error.recovery) ? error.recovery : [error.recovery];
        errorContent += '\n\n' + recoveryMessages.map((msg) => `💡 ${msg}`).join('\n');
    }

    return errorContent;
}

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
    /** Setter for session state (for session switch on compaction) */
    setSession: React.Dispatch<React.SetStateAction<import('../state/types.js').SessionState>>;
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
    /** Event emitter for emitting auto-approval responses */
    eventBus: Pick<import('@dexto/core').AgentEventBus, 'emit'>;
    /** Sound notification service for playing sounds on events */
    soundService?: import('../utils/soundNotification.js').SoundNotificationService;
    /** Optional setter for todos (from service:event todo updates) */
    setTodos?: React.Dispatch<React.SetStateAction<import('../state/types.js').TodoItem[]>>;
}

/**
 * Internal state for tracking the current streaming message
 */
interface StreamState {
    messageId: string | null;
    content: string;
    /** Input tokens from most recent LLM response (replaced, not summed) */
    lastInputTokens: number;
    /** Cumulative output tokens across all LLM responses in this turn */
    cumulativeOutputTokens: number;
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
        setSession: _setSession,
        setQueuedMessages,
        setApproval,
        setApprovalQueue,
    } = setters;
    const useStreaming = options?.useStreaming ?? true;

    // Link approval IDs to tool call IDs so we can finalize tool UI when an approval
    // is cancelled/denied (otherwise tool messages can remain stuck in "Waiting...").
    const approvalIdToToolCallId = new Map<string, string>();

    // Track streaming state (synchronous, not React state)
    const state: StreamState = {
        messageId: null,
        content: '',
        lastInputTokens: 0,
        cumulativeOutputTokens: 0,
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

    const formatQueuedMessagesForDisplay = (
        messages: import('@dexto/core').QueuedMessage[]
    ): string => {
        const userMessages = messages.filter((message) => message.kind !== 'background');
        if (userMessages.length === 0) {
            return '';
        }
        if (userMessages.length === 1) {
            return extractTextContent(userMessages[0]?.content ?? []) || '[attachment]';
        }
        return userMessages
            .map((message, index) => {
                const prefix =
                    userMessages.length === 2 ? (index === 0 ? 'First' : 'Also') : `[${index + 1}]`;
                const content = extractTextContent(message.content) || '[attachment]';
                return `${prefix}: ${content}`;
            })
            .join('\n\n');
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

    // Debug logging: enable via DEXTO_DEBUG_STREAM=true
    const debug = createDebugLogger('stream');
    debug.reset();
    debug.log('CONFIG', { useStreaming });

    try {
        for await (const event of iterator) {
            debug.log(`EVENT: ${event.name}`, {
                ...(event.name === 'llm:chunk' &&
                    'chunkType' in event && {
                        chunkType: event.chunkType,
                        contentLen: event.content?.length,
                    }),
                ...(event.name === 'llm:tool-call' &&
                    'toolName' in event && {
                        toolName: event.toolName,
                    }),
            });

            switch (event.name) {
                case 'llm:thinking': {
                    debug.log('THINKING: resetting state', {
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
                    state.lastInputTokens = 0;
                    state.cumulativeOutputTokens = 0;
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
                            debug.log('CHUNK (non-stream): accumulated', {
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
                        debug.log('CHUNK (stream): text', {
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

                    // Track token usage: replace input (last context), accumulate output
                    // Subtract cacheWriteTokens to exclude system prompt on first call
                    if (event.tokenUsage) {
                        const rawInputTokens = event.tokenUsage.inputTokens ?? 0;
                        const cacheWriteTokens = event.tokenUsage.cacheWriteTokens ?? 0;
                        const inputTokens = Math.max(0, rawInputTokens - cacheWriteTokens);
                        if (inputTokens > 0) {
                            state.lastInputTokens = inputTokens;
                        }
                        if (event.tokenUsage.outputTokens) {
                            state.cumulativeOutputTokens += event.tokenUsage.outputTokens;
                        }
                    }

                    // Track token usage analytics
                    if (
                        event.tokenUsage &&
                        (event.tokenUsage.inputTokens || event.tokenUsage.outputTokens)
                    ) {
                        // Calculate estimate accuracy if both estimate and actual are available
                        let estimateAccuracyPercent: number | undefined;
                        if (
                            event.estimatedInputTokens !== undefined &&
                            event.tokenUsage.inputTokens
                        ) {
                            const diff = event.estimatedInputTokens - event.tokenUsage.inputTokens;
                            estimateAccuracyPercent = Math.round(
                                (diff / event.tokenUsage.inputTokens) * 100
                            );
                        }

                        capture('dexto_llm_tokens_consumed', {
                            source: 'cli',
                            sessionId: event.sessionId,
                            provider: event.provider,
                            model: event.model,
                            inputTokens: event.tokenUsage.inputTokens,
                            outputTokens: event.tokenUsage.outputTokens,
                            reasoningTokens: event.tokenUsage.reasoningTokens,
                            totalTokens: event.tokenUsage.totalTokens,
                            cacheReadTokens: event.tokenUsage.cacheReadTokens,
                            cacheWriteTokens: event.tokenUsage.cacheWriteTokens,
                            estimatedInputTokens: event.estimatedInputTokens,
                            estimateAccuracyPercent,
                        });
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
                    if (shouldHideTool(event.toolName)) {
                        break;
                    }
                    debug.log('TOOL-CALL: state check', {
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
                            debug.log('TOOL-CALL: finalizing pending message', {
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
                            debug.log('TOOL-CALL: removing empty pending message', {
                                messageId: state.messageId,
                            });
                            removeFromPending(state.messageId);
                        }
                        state.messageId = null;
                        state.content = '';
                    } else {
                        debug.log('TOOL-CALL: no pending message to finalize');
                    }

                    // Non-streaming mode: add accumulated text as finalized message
                    if (!useStreaming && state.nonStreamingAccumulatedText) {
                        debug.log('TOOL-CALL: adding non-stream accumulated text', {
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

                    // Format tool header using shared utility
                    const { header: toolContent } = formatToolHeader(
                        event.toolName,
                        (event.args as Record<string, unknown>) || {}
                    );

                    // Add description if present (dim styling, on new line)
                    let finalToolContent = toolContent;
                    const description = event.args?.description;
                    if (description && typeof description === 'string') {
                        finalToolContent += `\n${chalk.dim(description)}`;
                    }

                    // Tool calls start in 'pending' state (don't know if approval needed yet)
                    // Status transitions: pending → pending_approval (if approval needed) → running → finished
                    // Or for pre-approved: pending → running → finished
                    addToPending({
                        id: toolMessageId,
                        role: 'tool',
                        content: finalToolContent,
                        timestamp: new Date(),
                        toolStatus: 'pending',
                    });

                    // Track tool called analytics
                    capture('dexto_tool_called', {
                        source: 'cli',
                        sessionId: event.sessionId,
                        toolName: event.toolName,
                    });
                    break;
                }

                case 'llm:tool-result': {
                    if (shouldHideTool(event.toolName)) {
                        break;
                    }
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

                    // Handle plan_review tool results - update UI state when plan is approved
                    if (event.toolName === 'plan_review' && event.success !== false) {
                        try {
                            const planReviewResult = event.rawResult as {
                                approved?: boolean;
                            } | null;
                            if (planReviewResult?.approved) {
                                // User approved the plan - disable plan mode
                                setUi((prev) => ({
                                    ...prev,
                                    planModeActive: false,
                                    planModeInitialized: false,
                                }));
                            }
                        } catch {
                            // Silently ignore parsing errors - plan mode state remains unchanged
                        }
                    }

                    // Track tool result analytics
                    capture('dexto_tool_result', {
                        source: 'cli',
                        sessionId: event.sessionId,
                        toolName: event.toolName || 'unknown',
                        success: event.success !== false,
                    });
                    break;
                }

                case 'llm:error': {
                    const errorContent = buildErrorContent(event.error, 'Error: ');

                    // Add error message to finalized
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: errorContent,
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

                case 'llm:unsupported-input': {
                    // Show warning for unsupported features (e.g., model doesn't support tool calling)
                    const warningContent = '⚠️  ' + event.errors.join('\n⚠️  ');

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('warning'),
                            role: 'system',
                            content: warningContent,
                            timestamp: new Date(),
                        },
                    ]);
                    break;
                }

                case 'run:complete': {
                    const { durationMs } = event;
                    // Total = lastInput + cumulativeOutput (avoids double-counting shared context)
                    const totalTokens = state.lastInputTokens + state.cumulativeOutputTokens;

                    // Ensure any remaining pending messages are finalized
                    finalizeAllPending();

                    // Add run summary message at the END (not inserted in middle)
                    // IMPORTANT: Ink's <Static> tracks rendered items by array position, not key.
                    // Inserting in the middle shifts existing items, causing them to re-render.
                    // Always append to avoid duplicate rendering.
                    if (durationMs > 0 || totalTokens > 0) {
                        const summaryMessage = {
                            id: generateMessageId('summary'),
                            role: 'system' as const,
                            content: '', // Content rendered via styledType
                            timestamp: new Date(),
                            styledType: 'run-summary' as const,
                            styledData: {
                                durationMs,
                                totalTokens,
                            },
                        };

                        setMessages((prev) => [...prev, summaryMessage]);
                    }

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                        isCompacting: false,
                    }));

                    // Play completion sound to notify user task is done
                    options.soundService?.playCompleteSound();
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

                    if (event.messages?.some((message) => message.kind === 'background')) {
                        const userText = event.messages
                            ? formatQueuedMessagesForDisplay(event.messages)
                            : '';
                        if (userText) {
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: generateMessageId('user'),
                                    role: 'user' as const,
                                    content: userText,
                                    timestamp: new Date(),
                                },
                            ]);
                        }
                        setQueuedMessages([]);
                        setUi((prev) => ({ ...prev, isProcessing: true }));
                        break;
                    }

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

                // Note: context:compacting and context:compacted are handled in useAgentEvents.ts
                // as the single source of truth for both manual /compact and auto-compaction

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

                        if (isAutoApprovableInEditMode(toolName)) {
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
                        approvalIdToToolCallId.set(event.approvalId, toolCallId);
                        updatePendingStatus(`tool-${toolCallId}`, 'pending_approval');
                    }

                    // Show approval UI (moved from useAgentEvents for ordering)
                    if (
                        event.type === ApprovalTypeEnum.TOOL_CONFIRMATION ||
                        event.type === ApprovalTypeEnum.COMMAND_CONFIRMATION ||
                        event.type === ApprovalTypeEnum.ELICITATION ||
                        event.type === ApprovalTypeEnum.DIRECTORY_ACCESS
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

                        // Play approval sound to notify user
                        options.soundService?.playApprovalSound();
                    }
                    break;
                }

                case 'approval:response': {
                    // Handle approval responses.
                    //
                    // 1) Dismiss auto-approved parallel tool calls (existing behavior)
                    // 2) Finalize tool UI immediately for denied/cancelled approvals so tool
                    //    messages don't remain stuck in "Waiting..." (pending_approval).

                    const { approvalId } = event;

                    const toolCallId = approvalIdToToolCallId.get(approvalId);
                    if (toolCallId) {
                        approvalIdToToolCallId.delete(approvalId);

                        // If the tool was waiting for approval and gets denied/cancelled,
                        // we may not get a corresponding llm:tool-result event (the tool never ran).
                        // Finalize it here so the UI reflects the outcome immediately.
                        if (event.status !== ApprovalStatus.APPROVED) {
                            finalizeMessage(`tool-${toolCallId}`, {
                                toolStatus: 'finished',
                                toolResult: 'Cancelled',
                                isError: true,
                            });
                        }
                    }

                    // Step 1: Remove from queue if present
                    setApprovalQueue((queue) => queue.filter((a) => a.approvalId !== approvalId));

                    // Step 2: If this is the current approval, dismiss and show next
                    // We use the same pattern as completeApproval in OverlayContainer:
                    // setApprovalQueue as coordinator, calling setApproval inside
                    setApproval((currentApproval) => {
                        if (currentApproval?.approvalId !== approvalId) {
                            return currentApproval; // Not current, nothing to do
                        }

                        // Current approval was responded to - show next or close
                        // Note: queue was already filtered in Step 1, so we read updated queue
                        setApprovalQueue((queue) => {
                            if (queue.length > 0) {
                                const [next, ...rest] = queue;
                                setApproval(next!);
                                setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                                return rest;
                            } else {
                                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                                return [];
                            }
                        });

                        return null; // Clear current while setApprovalQueue handles next
                    });

                    break;
                }

                case 'service:event': {
                    // Handle service events - extensible pattern for non-core services
                    debug.log('SERVICE-EVENT received', {
                        service: event.service,
                        eventType: event.event,
                        toolCallId: event.toolCallId,
                        sessionId: event.sessionId,
                    });

                    // Handle agent-spawner progress events
                    if (event.service === 'agent-spawner' && event.event === 'progress') {
                        const { toolCallId, data } = event;
                        // Guard against null/non-object data payloads
                        if (toolCallId && data && typeof data === 'object') {
                            // Update the tool message with sub-agent progress
                            const toolMessageId = `tool-${toolCallId}`;
                            const progressData = data as {
                                task: string;
                                agentId: string;
                                toolsCalled: number;
                                currentTool: string;
                                currentArgs?: Record<string, unknown>;
                                tokenUsage?: {
                                    input: number;
                                    output: number;
                                    total: number;
                                };
                            };
                            debug.log('SERVICE-EVENT updating progress', {
                                toolMessageId,
                                toolsCalled: progressData.toolsCalled,
                                currentTool: progressData.currentTool,
                                tokenUsage: progressData.tokenUsage,
                            });
                            updatePending(toolMessageId, {
                                subAgentProgress: {
                                    task: progressData.task,
                                    agentId: progressData.agentId,
                                    toolsCalled: progressData.toolsCalled,
                                    currentTool: progressData.currentTool,
                                    ...(progressData.currentArgs && {
                                        currentArgs: progressData.currentArgs,
                                    }),
                                    ...(progressData.tokenUsage && {
                                        tokenUsage: progressData.tokenUsage,
                                    }),
                                },
                            });
                        }
                    }

                    // Handle todo update events
                    if (event.service === 'todo' && event.event === 'updated') {
                        const { data, sessionId } = event;
                        if (data && typeof data === 'object' && sessionId) {
                            const todoData = data as {
                                todos?: Array<{
                                    id: string;
                                    sessionId: string;
                                    content: string;
                                    activeForm: string;
                                    status: 'pending' | 'in_progress' | 'completed';
                                    position: number;
                                    createdAt: Date | string;
                                    updatedAt: Date | string;
                                }>;
                                stats?: { created: number; updated: number; deleted: number };
                            };
                            if (!Array.isArray(todoData.todos)) {
                                debug.log('SERVICE-EVENT todo updated: invalid payload', {
                                    sessionId,
                                });
                                break;
                            }
                            debug.log('SERVICE-EVENT todo updated', {
                                sessionId,
                                todoCount: todoData.todos.length,
                                stats: todoData.stats,
                            });
                            // Update todos state via the setter passed in options
                            if (options.setTodos) {
                                options.setTodos(todoData.todos);
                            }
                        }
                    }
                    break;
                }

                // Ignore other events
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

            const errorContent = buildErrorContent(error, 'Stream error: ');

            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('error'),
                    role: 'system',
                    content: errorContent,
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
