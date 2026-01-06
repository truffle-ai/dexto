import React, { useRef, useEffect, useCallback } from 'react';
import type { Issue, SanitizedToolResult, ToolApprovalStatus } from '@dexto/core';
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

// =============================================================================
// WebUI Message Types (Discriminated Union by 'role')
// =============================================================================

/** Content type for WebUI messages (JSON-serializable, string-only) */
export type UIContentPart = TextPart | ImagePart | AudioPart | FilePart | UIResourcePart;

/** Base interface for all WebUI message types */
interface UIMessageBase {
    id: string;
    createdAt: number;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}

/** User message in WebUI */
export interface UIUserMessage extends UIMessageBase {
    role: 'user';
    content: string | null | UIContentPart[];
    imageData?: { image: string; mimeType: string };
    fileData?: FileData;
}

/** Assistant message in WebUI */
export interface UIAssistantMessage extends UIMessageBase {
    role: 'assistant';
    content: string | null;
    reasoning?: string;
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
    model?: string;
    provider?: LLMProvider;
}

/** Tool message in WebUI */
export interface UIToolMessage extends UIMessageBase {
    role: 'tool';
    content: string | null | UIContentPart[];
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolCallId?: string;
    toolResult?: ToolResult;
    toolResultMeta?: SanitizedToolResult['meta'];
    toolResultSuccess?: boolean;
    requireApproval?: boolean;
    approvalStatus?: ToolApprovalStatus;
}

/** Discriminated union of all WebUI message types */
export type Message = UIUserMessage | UIAssistantMessage | UIToolMessage;

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

// Separate error state interface
export interface ErrorMessage {
    id: string;
    message: string;
    timestamp: number;
    context?: string;
    recoverable?: boolean;
    sessionId?: string;
    // Message id this error relates to (e.g., last user input)
    anchorMessageId?: string;
    // Raw validation issues for hierarchical display
    detailedIssues?: Issue[];
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
    // When true, llm:chunk events update UI incrementally. When false, wait for llm:response.
    const isStreamingRef = useRef<boolean>(true);

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
                case 'llm:thinking':
                    // LLM started thinking - can update UI status
                    useChatStore.getState().setProcessing(event.sessionId, true);
                    break;

                case 'llm:chunk': {
                    // When not streaming, skip chunk updates - llm:response will show full content
                    if (!isStreamingRef.current) {
                        break;
                    }

                    const text = event.content || '';
                    const chunkType = event.chunkType;
                    //console.log('llm:chunk', event);

                    // Use streaming message API for incremental updates
                    const store = useChatStore.getState();
                    const sessionState = store.getSessionState(event.sessionId);

                    if (chunkType === 'reasoning') {
                        // For reasoning chunks, append to streaming message or create new one
                        const lastMsg = sessionState.messages[sessionState.messages.length - 1];
                        if (
                            lastMsg &&
                            lastMsg.role === 'assistant' &&
                            !sessionState.streamingMessage
                        ) {
                            // Update existing message
                            store.updateMessage(event.sessionId, lastMsg.id, {
                                reasoning: (lastMsg.reasoning || '') + text,
                                createdAt: Date.now(),
                            });
                        } else {
                            // Create or append to streaming message
                            if (!sessionState.streamingMessage) {
                                const newId = generateUniqueId();
                                lastMessageIdRef.current = newId;
                                store.setStreamingMessage(event.sessionId, {
                                    id: newId,
                                    role: 'assistant',
                                    content: '',
                                    reasoning: text,
                                    createdAt: Date.now(),
                                });
                            } else {
                                store.appendToStreamingMessage(event.sessionId, text, 'reasoning');
                            }
                        }
                    } else {
                        // For content chunks, append to streaming message or create new one
                        const lastMsg = sessionState.messages[sessionState.messages.length - 1];
                        if (
                            lastMsg &&
                            lastMsg.role === 'assistant' &&
                            !sessionState.streamingMessage
                        ) {
                            // Update existing message
                            const currentContent =
                                typeof lastMsg.content === 'string' ? lastMsg.content : '';
                            store.updateMessage(event.sessionId, lastMsg.id, {
                                content: currentContent + text,
                                createdAt: Date.now(),
                            });
                        } else {
                            // Create or append to streaming message
                            if (!sessionState.streamingMessage) {
                                const newId = generateUniqueId();
                                lastMessageIdRef.current = newId;
                                store.setStreamingMessage(event.sessionId, {
                                    id: newId,
                                    role: 'assistant',
                                    content: text,
                                    createdAt: Date.now(),
                                });
                            } else {
                                store.appendToStreamingMessage(event.sessionId, text, 'text');
                            }
                        }
                    }
                    break;
                }

                case 'llm:response': {
                    // NOTE: Don't set processing=false here - wait for run:complete
                    // This allows queued messages to continue processing after this response
                    console.log('llm:response', event);
                    const text = event.content || '';
                    const usage = event.tokenUsage;
                    const model = event.model;
                    const provider = event.provider;
                    const finalContent = typeof text === 'string' ? text : '';

                    const store = useChatStore.getState();
                    const sessionState = store.getSessionState(event.sessionId);
                    const lastMsg = sessionState.messages[sessionState.messages.length - 1];

                    if (lastMsg && lastMsg.role === 'assistant') {
                        // Update existing assistant message
                        store.updateMessage(event.sessionId, lastMsg.id, {
                            content: finalContent,
                            tokenUsage: usage,
                            ...(model && { model }),
                            ...(provider && { provider }),
                            createdAt: Date.now(),
                        });
                    } else if (finalContent) {
                        // No assistant message exists - create one if we have content
                        // This handles multi-step turns where llm:response arrives after tool calls
                        const newId = generateUniqueId();
                        lastMessageIdRef.current = newId;
                        store.addMessage(event.sessionId, {
                            id: newId,
                            role: 'assistant',
                            content: finalContent,
                            tokenUsage: usage,
                            ...(model && { model }),
                            ...(provider && { provider }),
                            createdAt: Date.now(),
                        });
                    }

                    // Finalize any streaming message
                    if (sessionState.streamingMessage) {
                        store.finalizeStreamingMessage(event.sessionId, {
                            content: finalContent,
                            tokenUsage: usage,
                            ...(model && { model }),
                            ...(provider && { provider }),
                        });
                    }

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
            stream = true // Controls whether chunks are shown incrementally
        ) => {
            if (!sessionId) {
                console.error('Session ID required for sending message');
                return;
            }

            // Abort previous request if any
            abortSession(sessionId);

            const abortController = getAbortController(sessionId) || new AbortController();

            useChatStore.getState().setProcessing(sessionId, true);

            // Add user message to state
            const userId = generateUniqueId();
            lastUserMessageIdRef.current = userId;
            lastMessageIdRef.current = userId; // Track for error anchoring
            useChatStore.getState().addMessage(sessionId, {
                id: userId,
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
                // Build content parts array from text, image, and file data
                // New API uses unified ContentInput = string | ContentPart[]
                const contentParts: Array<
                    | { type: 'text'; text: string }
                    | { type: 'image'; image: string; mimeType?: string }
                    | { type: 'file'; data: string; mimeType: string; filename?: string }
                > = [];

                if (content) {
                    contentParts.push({ type: 'text', text: content });
                }
                if (imageData) {
                    contentParts.push({
                        type: 'image',
                        image: imageData.image,
                        mimeType: imageData.mimeType,
                    });
                }
                if (fileData) {
                    contentParts.push({
                        type: 'file',
                        data: fileData.data,
                        mimeType: fileData.mimeType,
                        filename: fileData.filename,
                    });
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

                useChatStore.getState().setProcessing(sessionId, false);
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
