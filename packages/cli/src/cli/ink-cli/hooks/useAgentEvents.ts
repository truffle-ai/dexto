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
 * - message:queued - New message added to queue
 * - message:removed - Message removed from queue (e.g., up arrow edit)
 *
 * Uses AbortController pattern for cleanup.
 */

import type React from 'react';
import { useEffect } from 'react';
import { setMaxListeners } from 'events';
import type { DextoAgent, QueuedMessage } from '@dexto/core';
import { ApprovalType as ApprovalTypeEnum } from '@dexto/core';
import type { Message, OverlayType, McpWizardServerType } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/**
 * UI state shape (must match InkCLIRefactored)
 */
interface UIState {
    isProcessing: boolean;
    isCancelling: boolean;
    isThinking: boolean;
    activeOverlay: OverlayType;
    exitWarningShown: boolean;
    exitWarningTimestamp: number | null;
    mcpWizardServerType: McpWizardServerType;
    copyModeEnabled: boolean;
}

/**
 * Session state shape
 */
interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string;
}

interface UseAgentEventsProps {
    agent: DextoAgent;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
}

/**
 * Subscribes to agent event bus for non-streaming events only.
 * Streaming events are handled via agent.stream() iterator.
 */
export function useAgentEvents({
    agent,
    setMessages,
    setUi,
    setSession,
    setApproval,
    setApprovalQueue,
    setQueuedMessages,
}: UseAgentEventsProps): void {
    useEffect(() => {
        const bus = agent.agentEventBus;
        const controller = new AbortController();
        const { signal } = controller;

        // Increase listener limit for safety
        setMaxListeners(15, signal);

        // Handle approval requests - these can arrive during streaming
        bus.on(
            'approval:request',
            (event) => {
                if (
                    event.type === ApprovalTypeEnum.TOOL_CONFIRMATION ||
                    event.type === ApprovalTypeEnum.COMMAND_CONFIRMATION
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
            },
            { signal }
        );

        // Handle model switch
        bus.on(
            'llm:switched',
            (payload) => {
                if (payload.newConfig?.model) {
                    setSession((prev) => ({ ...prev, modelName: payload.newConfig.model }));
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
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
            },
            { signal }
        );

        // Handle session creation (e.g., from /clear command)
        bus.on(
            'session:created',
            (payload) => {
                if (payload.switchTo) {
                    setMessages([]);
                    setApproval(null);
                    setApprovalQueue([]);
                    setQueuedMessages([]);

                    if (payload.sessionId === null) {
                        setSession((prev) => ({ ...prev, id: null, hasActiveSession: false }));
                    } else {
                        setSession((prev) => ({
                            ...prev,
                            id: payload.sessionId,
                            hasActiveSession: true,
                        }));
                    }
                    setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                }
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

        // Cleanup: abort controller removes all listeners at once
        return () => {
            controller.abort();
        };
    }, [agent, setMessages, setUi, setSession, setApproval, setApprovalQueue, setQueuedMessages]);
}
