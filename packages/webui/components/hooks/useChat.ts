import React, { useRef, useEffect, useCallback } from 'react';
import type { SanitizedToolResult } from '@dexto/core';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics/index.js';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { createMessageStream } from '@dexto/client-sdk';
import type { MessageStreamEvent } from '@dexto/client-sdk';
import { eventBus } from '@/lib/events/EventBus.js';
import { useChatStore } from '@/lib/stores/chatStore.js';
import type { Session } from './useSessions.js';
import type { Attachment } from '../../lib/attachment-types.js';

// Tool result types
export interface ToolResultError {
    error: string | Record<string, unknown>;
}

export type ToolResultContent = SanitizedToolResult;

export type ToolResult = ToolResultError | SanitizedToolResult | string | Record<string, unknown>;

// Type guards for tool results
export function isToolResultError(result: unknown): result is ToolResultError {
    return typeof result === 'object' && result !== null && 'error' in result;
}

export function isToolResultContent(result: unknown): result is ToolResultContent {
    return (
        typeof result === 'object' &&
        result !== null &&
        'content' in result &&
        Array.isArray((result as ToolResultContent).content)
    );
}

// =============================================================================
// Re-export Message types from chatStore (single source of truth)
// =============================================================================

// Import from chatStore
import type { Message } from '@/lib/stores/chatStore.js';

// Re-export for API compatibility - components can import these from either place
export type { Message, ErrorMessage } from '@/lib/stores/chatStore.js';

// Legacy type aliases for code that uses the discriminated union pattern
// These are intersection types that narrow the Message type by role
export type UIUserMessage = Message & { role: 'user' };
export type UIAssistantMessage = Message & { role: 'assistant' };
export type UIToolMessage = Message & { role: 'tool' };

// =============================================================================
// Message Type Guards
// =============================================================================

/** Type guard for user messages */
export function isUserMessage(msg: Message): msg is UIUserMessage {
    return msg.role === 'user';
}

/** Type guard for assistant messages */
export function isAssistantMessage(msg: Message): msg is UIAssistantMessage {
    return msg.role === 'assistant';
}

/** Type guard for tool messages */
export function isToolMessage(msg: Message): msg is UIToolMessage {
    return msg.role === 'tool';
}

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed';

const generateUniqueId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export function useChat(
    activeSessionIdRef: React.MutableRefObject<string | null>,
    abortControllersRef: React.MutableRefObject<Map<string, AbortController>>
) {
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);
    const queryClient = useQueryClient();

    // Helper to update sessions cache (replaces DOM events)
    const updateSessionActivity = useCallback(
        (sessionId: string, incrementMessageCount: boolean = true) => {
            queryClient.setQueryData<Session[]>(queryKeys.sessions.all, (old = []) => {
                const exists = old.some((s) => s.id === sessionId);
                if (exists) {
                    return old.map((session) =>
                        session.id === sessionId
                            ? {
                                  ...session,
                                  ...(incrementMessageCount && {
                                      messageCount: session.messageCount + 1,
                                  }),
                                  lastActivity: Date.now(),
                              }
                            : session
                    );
                } else {
                    // Create new session entry
                    const newSession: Session = {
                        id: sessionId,
                        createdAt: Date.now(),
                        lastActivity: Date.now(),
                        messageCount: 1,
                        title: null,
                    };
                    return [newSession, ...old];
                }
            });
        },
        [queryClient]
    );

    const updateSessionTitle = useCallback(
        (sessionId: string, title: string) => {
            queryClient.setQueryData<Session[]>(queryKeys.sessions.all, (old = []) =>
                old.map((session) => (session.id === sessionId ? { ...session, title } : session))
            );
        },
        [queryClient]
    );

    // Track message IDs for error anchoring
    const lastUserMessageIdRef = useRef<string | null>(null);
    const lastMessageIdRef = useRef<string | null>(null);
    // Map callId to message index for O(1) tool result pairing
    const pendingToolCallsRef = useRef<Map<string, number>>(new Map());

    // Keep analytics ref updated
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // Abort controller management (moved from ChatContext)
    const getAbortController = useCallback(
        (sessionId: string): AbortController => {
            const existing = abortControllersRef.current.get(sessionId);
            if (existing) {
                return existing;
            }
            const controller = new AbortController();
            abortControllersRef.current.set(sessionId, controller);
            return controller;
        },
        [abortControllersRef]
    );

    const abortSession = useCallback(
        (sessionId: string) => {
            const controller = abortControllersRef.current.get(sessionId);
            if (controller) {
                controller.abort();
                abortControllersRef.current.delete(sessionId);
            }
        },
        [abortControllersRef]
    );

    const isForActiveSession = useCallback(
        (sessionId?: string): boolean => {
            if (!sessionId) return false;
            const current = activeSessionIdRef.current;
            return !!current && sessionId === current;
        },
        [activeSessionIdRef]
    );

    const processEvent = useCallback(
        (event: MessageStreamEvent) => {
            // All streaming events must have sessionId
            if (!event.sessionId) {
                console.error(`Event missing sessionId: ${JSON.stringify(event)}`);
                return;
            }

            // Check session match
            if (!isForActiveSession(event.sessionId)) {
                return;
            }

            // Dispatch to EventBus - handlers.ts will update chatStore
            // NOTE: All store updates (messages, streaming, processing) are handled by handlers.ts
            // This function only handles React-specific side effects not in handlers.ts:
            // - TanStack Query cache updates
            // - Analytics tracking
            // - Ref updates for error anchoring
            eventBus.dispatch(event);

            // Handle React-specific side effects not in handlers.ts
            // IMPORTANT: Do NOT update chatStore here - that's handled by handlers.ts via EventBus
            switch (event.name) {
                case 'llm:response': {
                    // Update sessions cache (response received)
                    updateSessionActivity(event.sessionId);
                    break;
                }

                case 'llm:tool-call': {
                    const { toolName, sessionId } = event;

                    // Track tool called analytics
                    if (toolName) {
                        analyticsRef.current.trackToolCalled({
                            toolName,
                            sessionId,
                        });
                    }
                    break;
                }

                case 'llm:tool-result': {
                    const { toolName, success } = event;

                    // Track tool result analytics
                    if (toolName) {
                        analyticsRef.current.trackToolResult({
                            toolName,
                            success: success !== false,
                            sessionId: event.sessionId,
                        });
                    }
                    break;
                }

                case 'session:title-updated': {
                    // Update TanStack Query cache
                    updateSessionTitle(event.sessionId, event.title);
                    break;
                }

                case 'message:dequeued': {
                    // Update sessions cache
                    updateSessionActivity(event.sessionId);

                    // Invalidate queue cache so UI removes the message
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.queue.list(event.sessionId),
                    });
                    break;
                }
            }
        },
        [isForActiveSession, analyticsRef, updateSessionActivity, updateSessionTitle, queryClient]
    );

    const sendMessage = useCallback(
        async (content: string, attachments?: Attachment[], sessionId?: string) => {
            if (!sessionId) {
                console.error('Session ID required for sending message');
                return;
            }

            // Abort previous request if any
            abortSession(sessionId);

            const abortController = getAbortController(sessionId) || new AbortController();

            useChatStore.getState().setProcessing(sessionId, true);

            // Add user message to state with attachments
            const userId = generateUniqueId();
            lastUserMessageIdRef.current = userId;
            lastMessageIdRef.current = userId; // Track for error anchoring

            // Convert attachments to legacy format for chatStore (temporary compatibility)
            const imageData = attachments?.find((a) => a.type === 'image');
            const fileData = attachments?.find((a) => a.type === 'file');

            useChatStore.getState().addMessage(sessionId, {
                id: userId,
                role: 'user',
                content,
                createdAt: Date.now(),
                sessionId,
                // Temporary: Store first image and first file for backward compatibility
                ...(imageData && {
                    imageData: {
                        image: imageData.data,
                        mimeType: imageData.mimeType,
                    },
                }),
                ...(fileData && {
                    fileData: {
                        data: fileData.data,
                        mimeType: fileData.mimeType,
                        filename: fileData.filename,
                    },
                }),
            });

            // Update sessions cache (user message sent)
            updateSessionActivity(sessionId);

            try {
                // Build content parts array from text and attachments
                const contentParts: Array<
                    | { type: 'text'; text: string }
                    | { type: 'image'; image: string; mimeType?: string }
                    | { type: 'file'; data: string; mimeType: string; filename?: string }
                > = [];

                if (content) {
                    contentParts.push({ type: 'text', text: content });
                }

                if (attachments) {
                    for (const attachment of attachments) {
                        if (attachment.type === 'image') {
                            contentParts.push({
                                type: 'image',
                                image: attachment.data,
                                mimeType: attachment.mimeType,
                            });
                        } else {
                            contentParts.push({
                                type: 'file',
                                data: attachment.data,
                                mimeType: attachment.mimeType,
                                filename: attachment.filename,
                            });
                        }
                    }
                }

                // Always use SSE for all events (tool calls, approvals, responses)
                // The 'stream' flag only controls whether chunks update UI incrementally
                const responsePromise = client.api['message-stream'].$post({
                    json: {
                        content:
                            contentParts.length === 1 && contentParts[0]?.type === 'text'
                                ? content // Simple text-only case: send as string
                                : contentParts, // Multimodal: send as array
                        sessionId,
                    },
                });

                const iterator = createMessageStream(responsePromise, {
                    signal: abortController.signal,
                });

                for await (const event of iterator) {
                    processEvent(event);
                }
            } catch (error: unknown) {
                // Handle abort gracefully
                if (error instanceof Error && error.name === 'AbortError') {
                    console.log('Stream aborted by user');
                    return;
                }

                console.error(
                    `Stream error: ${error instanceof Error ? error.message : String(error)}`
                );
                useChatStore.getState().setProcessing(sessionId, false);

                const message = error instanceof Error ? error.message : 'Failed to send message';
                useChatStore.getState().setError(sessionId, {
                    id: generateUniqueId(),
                    message,
                    timestamp: Date.now(),
                    context: 'stream',
                    recoverable: true,
                    sessionId,
                    anchorMessageId: lastMessageIdRef.current || undefined,
                });
            }
        },
        [processEvent, abortSession, getAbortController, updateSessionActivity]
    );

    const reset = useCallback(async (sessionId?: string) => {
        if (!sessionId) return;

        try {
            await client.api.reset.$post({
                json: { sessionId },
            });
        } catch (e) {
            console.error(`Failed to reset session: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Note: Messages are now in chatStore, not local state
        useChatStore.getState().setError(sessionId, null);
        lastUserMessageIdRef.current = null;
        lastMessageIdRef.current = null;
        pendingToolCallsRef.current.clear();
        useChatStore.getState().setProcessing(sessionId, false);
    }, []);

    const cancel = useCallback(async (sessionId?: string, clearQueue: boolean = false) => {
        if (!sessionId) return;

        // Tell server to cancel the LLM stream
        // Soft cancel (default): Only cancel current response, queued messages continue
        // Hard cancel (clearQueue=true): Cancel current response AND clear all queued messages
        try {
            await client.api.sessions[':sessionId'].cancel.$post({
                param: { sessionId },
                json: { clearQueue },
            });
        } catch (err) {
            // Server cancel is best-effort - log but don't throw
            console.warn('Failed to cancel server-side:', err);
        }

        // UI state will be updated when server sends run:complete event
        pendingToolCallsRef.current.clear();
    }, []);

    return {
        sendMessage,
        reset,
        cancel,
    };
}
