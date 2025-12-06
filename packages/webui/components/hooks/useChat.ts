import React, { useRef, useEffect, useCallback } from 'react';
import type { InternalMessage, Issue, SanitizedToolResult } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics/index.js';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { createMessageStream } from '@dexto/client-sdk';
import type { MessageStreamEvent } from '@dexto/client-sdk';
import { eventBus } from '@/lib/events/EventBus.js';
import {
    useChatStore,
    generateMessageId,
    type Message,
    type ErrorMessage,
} from '@/lib/stores/chatStore.js';
import type { Session } from './useSessions.js';

// Content part types - import from centralized types.ts
import type {
    TextPart,
    ImagePart,
    FilePart,
    AudioPart,
    FileData,
    UIResourcePart,
} from '../../types.js';

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

// Note: Message and ErrorMessage types now imported from chatStore.ts (single source of truth)
// Import with: import { type Message, type ErrorMessage } from '@/lib/stores/chatStore'

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

            // Dispatch to EventBus - handlers will update chatStore
            eventBus.dispatch(event);

            // Handle React-specific side effects not in handlers.ts
            switch (event.name) {
                case 'llm:response': {
                    // Update sessions cache (response received)
                    updateSessionActivity(event.sessionId);
                    break;
                }

                case 'llm:tool-result': {
                    const { toolName, success } = event;

                    // Track tool call completion analytics
                    if (toolName) {
                        analyticsRef.current.trackToolCalled({
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
        async (
            content: string,
            imageData?: { image: string; mimeType: string },
            fileData?: FileData,
            sessionId?: string,
            stream = true // Default to true for SSE
        ) => {
            if (!sessionId) {
                console.error('Session ID required for sending message');
                return;
            }

            // Abort previous request if any
            abortSession(sessionId);

            const abortController = getAbortController(sessionId) || new AbortController();

            // Set processing in chatStore for immediate UI feedback
            useChatStore.getState().setProcessing(sessionId, true);

            // Add user message to chatStore (optimistic UI)
            const userMessageId = generateMessageId();
            useChatStore.getState().addMessage(sessionId, {
                id: userMessageId,
                role: 'user',
                content,
                createdAt: Date.now(),
                sessionId,
                imageData,
                fileData,
            });

            // Update sessions cache (user message sent)
            updateSessionActivity(sessionId);

            try {
                if (stream) {
                    // Streaming mode: use /api/message-stream with SSE
                    const responsePromise = client.api['message-stream'].$post({
                        json: {
                            message: content,
                            sessionId,
                            imageData,
                            fileData,
                        },
                    });

                    const iterator = createMessageStream(responsePromise, {
                        signal: abortController.signal,
                    });

                    for await (const event of iterator) {
                        processEvent(event);
                    }

                    useChatStore.getState().setProcessing(sessionId, false);
                } else {
                    // Non-streaming mode: use /api/message-sync and wait for full response
                    const response = await client.api['message-sync'].$post({
                        json: {
                            message: content,
                            sessionId,
                            imageData,
                            fileData,
                        },
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(
                            `Failed to send message: ${response.status} ${response.statusText}. ${errorText}`
                        );
                    }

                    try {
                        // Parse JSON to validate response (data used via SSE events, not here)
                        await response.json();
                    } catch (parseError) {
                        const errorMessage =
                            parseError instanceof Error ? parseError.message : String(parseError);
                        throw new Error(`Failed to parse response: ${errorMessage}`);
                    }

                    // Note: Assistant response will be added to chatStore via events
                    // or handled by the component that calls sendMessage

                    useChatStore.getState().setProcessing(sessionId, false);

                    // Update sessions cache (response received)
                    updateSessionActivity(sessionId);
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
