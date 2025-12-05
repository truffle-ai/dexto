import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { InternalMessage, Issue, SanitizedToolResult } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalytics } from '@/lib/analytics/index.js';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { createMessageStream } from '@dexto/client-sdk';
import type { MessageStreamEvent } from '@dexto/client-sdk';
import { useApproval } from './ApprovalContext.js';
import type { Session } from './useSessions.js';

// Content part types and guards - import from centralized types.ts
import { isTextPart, isImagePart, isFilePart } from '../../types.js';
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

// Extend core InternalMessage for WebUI
export interface Message extends Omit<InternalMessage, 'content'> {
    id: string;
    createdAt: number;
    content: string | null | Array<TextPart | ImagePart | AudioPart | FilePart | UIResourcePart>;
    imageData?: { image: string; mimeType: string };
    fileData?: FileData;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolCallId?: string; // Unique identifier for pairing tool calls with results
    toolResult?: ToolResult;
    toolResultMeta?: SanitizedToolResult['meta'];
    toolResultSuccess?: boolean;
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
    reasoning?: string;
    model?: string;
    provider?: LLMProvider;
    sessionId?: string;
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

// Session-scoped state helpers interface
export interface SessionScopedStateHelpers {
    setSessionError: (sessionId: string, error: ErrorMessage | null) => void;
    setSessionProcessing: (sessionId: string, isProcessing: boolean) => void;
    setSessionStatus: (sessionId: string, status: StreamStatus) => void;
    getSessionAbortController: (sessionId: string) => AbortController;
    abortSession: (sessionId: string) => void;
}

const generateUniqueId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export function useChat(
    activeSessionIdRef: React.MutableRefObject<string | null>,
    sessionHelpers: SessionScopedStateHelpers
) {
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);
    const queryClient = useQueryClient();
    const { handleApprovalRequest, handleApprovalResponse } = useApproval();

    const [messages, setMessages] = useState<Message[]>([]);

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
    // lastUserMessageIdRef: tracks the most recent user message (for other purposes)
    // lastMessageIdRef: tracks the most recent message of ANY type (for error positioning)
    const lastUserMessageIdRef = useRef<string | null>(null);
    const lastMessageIdRef = useRef<string | null>(null);
    const suppressNextErrorRef = useRef<boolean>(false);
    // Map callId to message index for O(1) tool result pairing
    const pendingToolCallsRef = useRef<Map<string, number>>(new Map());

    // Keep analytics ref updated
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // Helper wrappers for session-scoped state
    const setError = useCallback(
        (sessionId: string, error: ErrorMessage | null) => {
            sessionHelpers.setSessionError(sessionId, error);
        },
        [sessionHelpers]
    );

    const setProcessing = useCallback(
        (sessionId: string, isProcessing: boolean) => {
            sessionHelpers.setSessionProcessing(sessionId, isProcessing);
        },
        [sessionHelpers]
    );

    const setStatus = useCallback(
        (sessionId: string, status: StreamStatus) => {
            sessionHelpers.setSessionStatus(sessionId, status);
        },
        [sessionHelpers]
    );

    const getAbortController = useCallback(
        (sessionId: string) => {
            return sessionHelpers.getSessionAbortController(sessionId);
        },
        [sessionHelpers]
    );

    const abortSession = useCallback(
        (sessionId: string) => {
            sessionHelpers.abortSession(sessionId);
        },
        [sessionHelpers]
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

            switch (event.name) {
                case 'llm:thinking':
                    // LLM started thinking - can update UI status
                    setProcessing(event.sessionId, true);
                    setStatus(event.sessionId, 'open');
                    break;

                case 'llm:chunk': {
                    const text = event.content || '';
                    const chunkType = event.chunkType;
                    //console.log('llm:chunk', event);

                    setMessages((ms) => {
                        if (chunkType === 'reasoning') {
                            const last = ms[ms.length - 1];
                            if (last && last.role === 'assistant') {
                                const updated = {
                                    ...last,
                                    reasoning: (last.reasoning || '') + text,
                                    createdAt: Date.now(),
                                };
                                return [...ms.slice(0, -1), updated];
                            }
                            // Creating new assistant message - track its ID for error anchoring
                            const newId = generateUniqueId();
                            lastMessageIdRef.current = newId;
                            return [
                                ...ms,
                                {
                                    id: newId,
                                    role: 'assistant',
                                    content: '',
                                    reasoning: text,
                                    createdAt: Date.now(),
                                },
                            ];
                        } else {
                            const last = ms[ms.length - 1];
                            if (last && last.role === 'assistant') {
                                const currentContent =
                                    typeof last.content === 'string' ? last.content : '';
                                const newContent = currentContent + text;
                                const updated = {
                                    ...last,
                                    content: newContent,
                                    createdAt: Date.now(),
                                };
                                return [...ms.slice(0, -1), updated];
                            }
                            // Creating new assistant message - track its ID for error anchoring
                            const newId = generateUniqueId();
                            lastMessageIdRef.current = newId;
                            return [
                                ...ms,
                                {
                                    id: newId,
                                    role: 'assistant',
                                    content: text,
                                    createdAt: Date.now(),
                                },
                            ];
                        }
                    });
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

                    setMessages((ms) => {
                        const lastMsg = ms[ms.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            const finalContent = typeof text === 'string' ? text : '';
                            const updatedMsg: Message = {
                                ...lastMsg,
                                content: finalContent,
                                tokenUsage: usage,
                                ...(model && { model }),
                                ...(provider && { provider }),
                                createdAt: Date.now(),
                            };
                            return [...ms.slice(0, -1), updatedMsg];
                        }
                        return ms;
                    });

                    // Update sessions cache (response received)
                    updateSessionActivity(event.sessionId);
                    break;
                }

                case 'llm:tool-call': {
                    const { toolName, args, callId } = event;
                    // Track tool message ID for error anchoring
                    const toolMsgId = generateUniqueId();
                    lastMessageIdRef.current = toolMsgId;
                    setMessages((ms) => {
                        const newIndex = ms.length;
                        const newMessages: Message[] = [
                            ...ms,
                            {
                                id: toolMsgId,
                                role: 'tool',
                                content: null,
                                toolName,
                                toolArgs: args,
                                toolCallId: callId,
                                createdAt: Date.now(),
                            },
                        ];
                        if (callId) {
                            pendingToolCallsRef.current.set(callId, newIndex);
                        }
                        return newMessages;
                    });
                    break;
                }

                case 'llm:tool-result': {
                    const {
                        callId,
                        success,
                        sanitized,
                        toolName,
                        requireApproval,
                        approvalStatus,
                    } = event;
                    const result = sanitized; // Core events use 'sanitized' field

                    // Track tool call completion
                    if (toolName) {
                        analyticsRef.current.trackToolCalled({
                            toolName,
                            success: success !== false,
                            sessionId: event.sessionId,
                        });
                    }

                    // Normalize result logic (simplified from original useChat)
                    // Note: The agent usually sanitizes results before emitting

                    setMessages((ms) => {
                        let idx = -1;
                        if (callId && pendingToolCallsRef.current.has(callId)) {
                            idx = pendingToolCallsRef.current.get(callId)!;
                            pendingToolCallsRef.current.delete(callId);
                        } else {
                            idx = ms.findIndex(
                                (m) =>
                                    m.role === 'tool' &&
                                    m.toolResult === undefined &&
                                    m.toolName === toolName
                            );
                        }

                        if (idx !== -1 && idx < ms.length) {
                            const updatedMsg = {
                                ...ms[idx],
                                toolResult: result,
                                toolResultSuccess: success,
                                // Preserve approval metadata from event
                                ...(requireApproval !== undefined && { requireApproval }),
                                ...(approvalStatus !== undefined && { approvalStatus }),
                            };
                            return [...ms.slice(0, idx), updatedMsg, ...ms.slice(idx + 1)];
                        }
                        return ms;
                    });
                    break;
                }

                case 'approval:request': {
                    // Forward SSE event payload to ApprovalContext
                    // Remove 'name' (SSE discriminant), keep 'type' (approval discriminant)
                    const { name: _, ...request } = event;
                    handleApprovalRequest(request);
                    break;
                }

                case 'approval:response': {
                    // Forward SSE event payload to ApprovalContext
                    const { name: _, ...response } = event;
                    handleApprovalResponse(response);
                    break;
                }

                case 'llm:error': {
                    if (suppressNextErrorRef.current) {
                        suppressNextErrorRef.current = false;
                        break;
                    }

                    const errorObj = event.error || {};
                    const message = errorObj.message || 'Unknown error';
                    console.log('llm:error', event);

                    setError(event.sessionId, {
                        id: generateUniqueId(),
                        message,
                        timestamp: Date.now(),
                        context: event.context,
                        recoverable: event.recoverable,
                        sessionId: event.sessionId,
                        // Use lastMessageIdRef to anchor error to the most recent message
                        // (not just user messages), so errors appear in correct position
                        anchorMessageId: lastMessageIdRef.current || undefined,
                    });
                    setProcessing(event.sessionId, false);
                    setStatus(event.sessionId, 'closed');
                    break;
                }

                case 'session:title-updated': {
                    updateSessionTitle(event.sessionId, event.title);
                    break;
                }

                case 'context:compressed': {
                    // Context was compressed during multi-step tool calling
                    // Log for debugging, could add UI notification in future
                    console.log(
                        `[Context Compressed] ${event.originalTokens.toLocaleString()} → ${event.compressedTokens.toLocaleString()} tokens ` +
                            `(${event.originalMessages} → ${event.compressedMessages} messages) via ${event.strategy}`
                    );
                    break;
                }

                case 'message:dequeued': {
                    // Queued message was processed - add as user message to UI
                    // Extract text content from the combined content array
                    const textContent = event.content
                        .filter(isTextPart)
                        .map((part) => part.text)
                        .join('\n');

                    // Extract image attachment if present
                    const imagePart = event.content.find(isImagePart);

                    // Extract file attachment if present
                    const filePart = event.content.find(isFilePart);

                    if (textContent || event.content.length > 0) {
                        const userId = generateUniqueId();
                        lastUserMessageIdRef.current = userId;
                        lastMessageIdRef.current = userId;
                        setMessages((ms) => [
                            ...ms,
                            {
                                id: userId,
                                role: 'user',
                                content: textContent || '[attachment]',
                                createdAt: Date.now(),
                                sessionId: event.sessionId,
                                imageData: imagePart
                                    ? {
                                          image: imagePart.image,
                                          mimeType: imagePart.mimeType ?? 'image/jpeg',
                                      }
                                    : undefined,
                                fileData: filePart
                                    ? {
                                          data: filePart.data,
                                          mimeType: filePart.mimeType,
                                          filename: filePart.filename,
                                      }
                                    : undefined,
                            },
                        ]);
                        // Update sessions cache
                        updateSessionActivity(event.sessionId);
                    }
                    // Immediately invalidate queue cache so UI removes the message
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.queue.list(event.sessionId),
                    });
                    break;
                }

                case 'run:complete': {
                    // Agent run fully completed (no more steps, no queued messages)
                    // NOW set processing to false - not on llm:response
                    console.log('run:complete', event);
                    setProcessing(event.sessionId, false);
                    setStatus(event.sessionId, 'closed');

                    // If there was an error, it's already been handled by llm:error
                    // Just log it here for debugging
                    if (event.error) {
                        console.log(
                            `Run ended with error (finishReason=${event.finishReason}):`,
                            event.error
                        );
                    }
                    break;
                }
            }
        },
        [
            isForActiveSession,
            setProcessing,
            setStatus,
            setError,
            handleApprovalRequest,
            handleApprovalResponse,
            updateSessionActivity,
            updateSessionTitle,
            queryClient,
        ]
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

            setProcessing(sessionId, true);
            setStatus(sessionId, 'connecting');

            // Add user message to state
            const userId = generateUniqueId();
            lastUserMessageIdRef.current = userId;
            lastMessageIdRef.current = userId; // Track for error anchoring
            setMessages((ms) => [
                ...ms,
                {
                    id: userId,
                    role: 'user',
                    content,
                    createdAt: Date.now(),
                    sessionId,
                    imageData,
                    fileData,
                },
            ]);

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

                    setStatus(sessionId, 'open');

                    for await (const event of iterator) {
                        processEvent(event);
                    }

                    setStatus(sessionId, 'closed');
                    setProcessing(sessionId, false);
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

                    let data;
                    try {
                        data = await response.json();
                    } catch (parseError) {
                        const errorMessage =
                            parseError instanceof Error ? parseError.message : String(parseError);
                        throw new Error(`Failed to parse response: ${errorMessage}`);
                    }

                    // Add assistant response as a complete message with metadata
                    setMessages((ms) => [
                        ...ms,
                        {
                            id: generateUniqueId(),
                            role: 'assistant',
                            content: data.response || '',
                            createdAt: Date.now(),
                            sessionId,
                            ...(data.tokenUsage && { tokenUsage: data.tokenUsage }),
                            ...(data.reasoning && { reasoning: data.reasoning }),
                            ...(data.model && { model: data.model }),
                            ...(data.provider && { provider: data.provider }),
                        },
                    ]);

                    setStatus(sessionId, 'closed');
                    setProcessing(sessionId, false);

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
                setStatus(sessionId, 'closed');
                setProcessing(sessionId, false);

                const message = error instanceof Error ? error.message : 'Failed to send message';
                setError(sessionId, {
                    id: generateUniqueId(),
                    message,
                    timestamp: Date.now(),
                    context: 'stream',
                    recoverable: true,
                    sessionId,
                    anchorMessageId: userId,
                });
            }
        },
        [
            processEvent,
            abortSession,
            getAbortController,
            setProcessing,
            setStatus,
            setError,
            updateSessionActivity,
        ]
    );

    const reset = useCallback(
        async (sessionId?: string) => {
            if (!sessionId) return;

            try {
                await client.api.reset.$post({
                    json: { sessionId },
                });
            } catch (e) {
                console.error(
                    `Failed to reset session: ${e instanceof Error ? e.message : String(e)}`
                );
            }

            setMessages([]);
            setError(sessionId, null);
            lastUserMessageIdRef.current = null;
            lastMessageIdRef.current = null;
            pendingToolCallsRef.current.clear();
            setProcessing(sessionId, false);
        },
        [setError, setProcessing]
    );

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
        messages,
        sendMessage,
        reset,
        setMessages,
        cancel,
    };
}
