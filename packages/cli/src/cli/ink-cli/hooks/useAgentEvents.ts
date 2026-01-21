/**
 * Hook for managing agent event bus subscriptions for NON-STREAMING events.
 *
 * Streaming events (llm:thinking, llm:chunk, llm:response, llm:tool-call, llm:tool-result,
 * llm:error, run:complete, message:dequeued) are handled via agent.stream() iterator in processStream.
 *
 * This hook handles:
 * - approval:request - Tool/command confirmation requests
 * - llm:switched - Model change notifications
 * - session:reset - Conversation reset
 * - session:created - New session creation (e.g., from /clear)
 * - context:compacting - Context compaction starting (from /compact or auto)
 * - context:compacted - Context compaction finished
 * - message:queued - New message added to queue
 * - message:removed - Message removed from queue (e.g., up arrow edit)
 * - run:invoke - External trigger (scheduler, A2A, API) starting a run
 * - run:complete (for external triggers) - External run finished
 *
 * Uses AbortController pattern for cleanup.
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import { setMaxListeners } from 'events';
import {
    getModelDisplayName,
    type DextoAgent,
    type QueuedMessage,
    type ContentPart,
} from '@dexto/core';
import type { Message, UIState, SessionState, InputState } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';

interface UseAgentEventsProps {
    agent: DextoAgent;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    /** Current session ID for filtering events */
    currentSessionId: string | null;
    /** Text buffer for input (source of truth) - needed to clear on session reset */
    buffer: TextBuffer;
}

/**
 * Extract text content from ContentPart array
 */
function extractTextContent(content: ContentPart[]): string {
    return content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
}

/**
 * Subscribes to agent event bus for non-streaming events only.
 * Streaming events are handled via agent.stream() iterator.
 *
 * Also handles external triggers (run:invoke) from scheduler, A2A, etc.
 */
export function useAgentEvents({
    agent,
    setMessages,
    setPendingMessages,
    setUi,
    setSession,
    setInput,
    setApproval,
    setApprovalQueue,
    setQueuedMessages,
    currentSessionId,
    buffer,
}: UseAgentEventsProps): void {
    // Track if an external trigger is active (scheduler, A2A, etc.)
    const externalTriggerRef = useRef<{
        active: boolean;
        sessionId: string | null;
        messageId: string | null;
    }>({ active: false, sessionId: null, messageId: null });

    useEffect(() => {
        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;

        // Increase listener limit for safety (added more for external trigger events)
        setMaxListeners(25, signal);

        // NOTE: approval:request is now handled in processStream (via iterator) for proper
        // event ordering. Direct bus subscription here caused a race condition where
        // approval UI showed before text messages were added.

        // Handle model switch
        bus.on(
            'llm:switched',
            (payload) => {
                if (payload.newConfig?.model) {
                    setSession((prev) => ({
                        ...prev,
                        modelName: getModelDisplayName(
                            payload.newConfig.model,
                            payload.newConfig.provider
                        ),
                    }));
                }
            },
            { signal }
        );

        // Handle conversation reset
        bus.on(
            'session:reset',
            () => {
                setMessages([]);
                setApproval(null);
                setApprovalQueue([]);
                setQueuedMessages([]);
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
            },
            { signal }
        );

        // Handle session creation (e.g., from /new command)
        bus.on(
            'session:created',
            (payload) => {
                if (payload.switchTo) {
                    // Clear the terminal screen for a fresh start (only in TTY environments)
                    // \x1B[2J clears visible screen, \x1B[3J clears scrollback, \x1B[H moves cursor to top
                    if (process.stdout.isTTY) {
                        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
                    }

                    // Clear all message state
                    setMessages([]);
                    setPendingMessages([]);
                    setApproval(null);
                    setApprovalQueue([]);
                    setQueuedMessages([]);

                    // Reset input state including history (up/down arrow) and Ctrl+R search state
                    // Clear TextBuffer first (source of truth), then sync React state
                    buffer.setText('');
                    setInput((prev) => ({
                        ...prev,
                        value: '',
                        history: [],
                        historyIndex: -1,
                        draftBeforeHistory: '',
                        images: [],
                        pastedBlocks: [],
                        pasteCounter: 0,
                    }));

                    if (payload.sessionId === null) {
                        setSession((prev) => ({ ...prev, id: null, hasActiveSession: false }));
                    } else {
                        setSession((prev) => ({
                            ...prev,
                            id: payload.sessionId,
                            hasActiveSession: true,
                        }));
                    }

                    // Reset UI state including history search
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        historySearch: {
                            isActive: false,
                            query: '',
                            matchIndex: 0,
                            originalInput: '',
                            lastMatch: '',
                        },
                    }));
                }
            },
            { signal }
        );

        // Handle context cleared (from /clear command)
        // Keep messages visible for user reference - only context sent to LLM is cleared
        // Just clean up any pending approvals/overlays/queued messages
        bus.on(
            'context:cleared',
            () => {
                setApproval(null);
                setApprovalQueue([]);
                setQueuedMessages([]);
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
            },
            { signal }
        );

        // Handle context compacting (from /compact command or auto-compaction)
        // Single source of truth - handles both manual /compact and auto-compaction during streaming
        bus.on(
            'context:compacting',
            (payload) => {
                if (payload.sessionId !== currentSessionId) return;
                setUi((prev) => ({ ...prev, isCompacting: true }));
            },
            { signal }
        );

        // Handle context compacted
        // Single source of truth - shows notification for all compaction (manual and auto)
        bus.on(
            'context:compacted',
            (payload) => {
                if (payload.sessionId !== currentSessionId) return;
                setUi((prev) => ({ ...prev, isCompacting: false }));

                const reductionPercent =
                    payload.originalTokens > 0
                        ? Math.round(
                              ((payload.originalTokens - payload.compactedTokens) /
                                  payload.originalTokens) *
                                  100
                          )
                        : 0;

                const compactionContent =
                    `📦 Context compacted\n` +
                    `   ${payload.originalMessages} messages → ${payload.compactedMessages} messages\n` +
                    `   ~${payload.originalTokens.toLocaleString()} → ~${payload.compactedTokens.toLocaleString()} tokens (${reductionPercent}% reduction)`;

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system' as const,
                        content: compactionContent,
                        timestamp: new Date(),
                    },
                ]);
            },
            { signal }
        );

        // Handle message queued - fetch full queue state from agent
        bus.on(
            'message:queued',
            (payload) => {
                if (!payload.sessionId) return;
                // Fetch fresh queue state from agent to ensure consistency
                agent
                    .getQueuedMessages(payload.sessionId)
                    .then((messages) => {
                        setQueuedMessages(messages);
                    })
                    .catch(() => {
                        // Silently ignore - queue state will sync on next event
                    });
            },
            { signal }
        );

        // Handle message removed from queue
        bus.on(
            'message:removed',
            (payload) => {
                setQueuedMessages((prev) => prev.filter((m) => m.id !== payload.id));
            },
            { signal }
        );

        // Note: message:dequeued is handled in processStream (via iterator) for proper synchronization
        // with streaming events. Don't handle it here via event bus.

        // ============================================================================
        // EXTERNAL TRIGGER HANDLING (scheduler, A2A, API)
        // When an external source invokes the agent, we receive events here instead of
        // through processStream (which only handles user-initiated streams).
        // ============================================================================

        // Handle external trigger invocation (scheduler, A2A, API)
        bus.on(
            'run:invoke',
            (payload) => {
                // Only handle if this is for the current session
                if (payload.sessionId !== currentSessionId) {
                    return;
                }

                // Mark external trigger as active
                const messageId = generateMessageId('assistant');
                externalTriggerRef.current = {
                    active: true,
                    sessionId: payload.sessionId,
                    messageId,
                };

                // Extract prompt text from content parts
                const promptText = extractTextContent(payload.content);

                // Add the scheduled prompt as a "user" message with a source indicator
                const sourceLabel =
                    payload.source === 'scheduler'
                        ? '⏰ Scheduled Task'
                        : payload.source === 'a2a'
                          ? '🤖 A2A Request'
                          : payload.source === 'api'
                            ? '🔌 API Request'
                            : '📥 External Request';

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system' as const,
                        content: `${sourceLabel}`,
                        timestamp: new Date(),
                    },
                    {
                        id: generateMessageId('user'),
                        role: 'user' as const,
                        content: promptText,
                        timestamp: new Date(),
                    },
                ]);

                // Set processing state
                setUi((prev) => ({
                    ...prev,
                    isProcessing: true,
                    isThinking: true,
                }));

                // Add assistant pending message for streaming
                setPendingMessages([
                    {
                        id: messageId,
                        role: 'assistant' as const,
                        content: '',
                        timestamp: new Date(),
                        isStreaming: true,
                    },
                ]);
            },
            { signal }
        );

        // Handle streaming chunks for external triggers
        bus.on(
            'llm:chunk',
            (payload) => {
                // Only handle if this is for an active external trigger
                if (
                    !externalTriggerRef.current.active ||
                    payload.sessionId !== externalTriggerRef.current.sessionId
                ) {
                    return;
                }

                // Only handle text chunks (not reasoning)
                if (payload.chunkType !== 'text') {
                    return;
                }

                // Update pending message with new content
                setPendingMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === externalTriggerRef.current.messageId
                            ? { ...msg, content: msg.content + payload.content }
                            : msg
                    )
                );

                // Clear thinking state once we start receiving chunks
                setUi((prev) => (prev.isThinking ? { ...prev, isThinking: false } : prev));
            },
            { signal }
        );

        // Handle LLM thinking for external triggers
        bus.on(
            'llm:thinking',
            (payload) => {
                if (
                    !externalTriggerRef.current.active ||
                    payload.sessionId !== externalTriggerRef.current.sessionId
                ) {
                    return;
                }

                setUi((prev) => ({ ...prev, isThinking: true }));
            },
            { signal }
        );

        // Handle run completion for external triggers
        bus.on(
            'run:complete',
            (payload) => {
                // Only handle if this is for an active external trigger
                if (
                    !externalTriggerRef.current.active ||
                    payload.sessionId !== externalTriggerRef.current.sessionId
                ) {
                    return;
                }

                // Finalize the pending message
                setPendingMessages((prev) => {
                    const pendingMsg = prev.find(
                        (m) => m.id === externalTriggerRef.current.messageId
                    );
                    if (pendingMsg) {
                        // Move to finalized messages
                        setMessages((msgs) => [...msgs, { ...pendingMsg, isStreaming: false }]);
                    }
                    // Clear pending
                    return prev.filter((m) => m.id !== externalTriggerRef.current.messageId);
                });

                // Clear processing state
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isThinking: false,
                }));

                // Reset external trigger tracking
                externalTriggerRef.current = { active: false, sessionId: null, messageId: null };
            },
            { signal }
        );

        // Cleanup: abort controller removes all listeners at once
        return () => {
            controller.abort();
        };
    }, [
        agent,
        setMessages,
        setPendingMessages,
        setUi,
        setSession,
        setInput,
        setApproval,
        setApprovalQueue,
        setQueuedMessages,
        currentSessionId,
        buffer,
    ]);
}
