// Add the client directive
'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type {
    TextPart as CoreTextPart,
    InternalMessage,
    FilePart,
    Issue,
    SanitizedToolResult,
} from '@dexto/core';
import type { LLMRouter, LLMProvider } from '@dexto/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { client } from '@/lib/client.js';
import { createMessageStream } from '@dexto/client-sdk';
import type { MessageStreamEvent } from '@dexto/client-sdk';

// Reuse the identical TextPart from core
export type TextPart = CoreTextPart;

// Define WebUI-specific media parts
export interface ImagePart {
    type: 'image';
    base64: string;
    mimeType: string;
}

export interface AudioPart {
    type: 'audio';
    base64: string;
    mimeType: string;
    filename?: string;
}

export interface FileData {
    base64: string;
    mimeType: string;
    filename?: string;
}

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

// Type guards for content parts
export function isTextPart(part: unknown): part is TextPart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'text'
    );
}

export function isImagePart(part: unknown): part is ImagePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'image'
    );
}

export function isAudioPart(part: unknown): part is AudioPart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'audio'
    );
}

export function isFilePart(part: unknown): part is FilePart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'file'
    );
}

// Extend core InternalMessage for WebUI
export interface Message extends Omit<InternalMessage, 'content'> {
    id: string;
    createdAt: number;
    content: string | null | Array<TextPart | ImagePart | AudioPart | FilePart>;
    imageData?: { base64: string; mimeType: string };
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
    router?: LLMRouter;
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

    const [messages, setMessages] = useState<Message[]>([]);

    // Track the last user message id to anchor errors inline in the UI
    const lastUserMessageIdRef = useRef<string | null>(null);
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
                console.error('Event missing sessionId:', event);
                return;
            }

            // Check session match
            if (!isForActiveSession(event.sessionId)) {
                return;
            }

            switch (event.type) {
                case 'llm:thinking':
                    // LLM started thinking - can update UI status
                    setProcessing(event.sessionId, true);
                    setStatus(event.sessionId, 'open');
                    break;

                case 'llm:chunk': {
                    const text = event.content || '';
                    const chunkType = event.chunkType;

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
                            return [
                                ...ms,
                                {
                                    id: generateUniqueId(),
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
                            return [
                                ...ms,
                                {
                                    id: generateUniqueId(),
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
                    setProcessing(event.sessionId, false);
                    const text = event.content || '';
                    const usage = event.tokenUsage;
                    const model = event.model;
                    const provider = event.provider;
                    const router = event.router;

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
                                ...(router && { router }),
                                createdAt: Date.now(),
                            };
                            return [...ms.slice(0, -1), updatedMsg];
                        }
                        return ms;
                    });

                    // Emit DOM event
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('dexto:response', {
                                detail: {
                                    text,
                                    sessionId: event.sessionId,
                                    tokenUsage: usage,
                                    timestamp: Date.now(),
                                },
                            })
                        );
                    }
                    break;
                }

                case 'llm:tool-call': {
                    const { toolName, args, callId } = event;
                    setMessages((ms) => {
                        const newIndex = ms.length;
                        const newMessages: Message[] = [
                            ...ms,
                            {
                                id: generateUniqueId(),
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
                    const { callId, success, sanitized, toolName } = event;
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
                            };
                            return [...ms.slice(0, idx), updatedMsg, ...ms.slice(idx + 1)];
                        }
                        return ms;
                    });
                    break;
                }

                case 'approval:request': {
                    // Dispatch event for ToolConfirmationHandler
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('approval:request', {
                                detail: {
                                    approvalId: event.approvalId,
                                    type: event.type,
                                    timestamp: event.timestamp,
                                    metadata: event.metadata,
                                    sessionId: event.sessionId,
                                },
                            })
                        );
                    }
                    break;
                }

                case 'approval:response': {
                    // Dispatch event for ToolConfirmationHandler to handle timeout/cancellation
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('approval:response', {
                                detail: {
                                    approvalId: event.approvalId,
                                    status: event.status,
                                    reason: event.reason,
                                    message: event.message,
                                    sessionId: event.sessionId,
                                },
                            })
                        );
                    }
                    break;
                }

                case 'llm:error': {
                    if (suppressNextErrorRef.current) {
                        suppressNextErrorRef.current = false;
                        break;
                    }

                    const errorObj = event.error || {};
                    const message = errorObj.message || 'Unknown error';

                    setError(event.sessionId, {
                        id: generateUniqueId(),
                        message,
                        timestamp: Date.now(),
                        context: event.context,
                        recoverable: event.recoverable,
                        sessionId: event.sessionId,
                        anchorMessageId: lastUserMessageIdRef.current || undefined,
                    });
                    setProcessing(event.sessionId, false);
                    setStatus(event.sessionId, 'closed');
                    break;
                }

                // Handle legacy events if server still sends them or mapped differently?
                // No, we are using new SSE stream.
            }
        },
        [isForActiveSession, setProcessing, setStatus, setError]
    );

    const sendMessage = useCallback(
        async (
            content: string,
            imageData?: { base64: string; mimeType: string },
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

            // Emit DOM event
            if (typeof window !== 'undefined') {
                window.dispatchEvent(
                    new CustomEvent('dexto:message', {
                        detail: { content, sessionId, timestamp: Date.now() },
                    })
                );
            }

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
                            ...(data.router && { router: data.router }),
                        },
                    ]);

                    setStatus(sessionId, 'closed');
                    setProcessing(sessionId, false);

                    // Emit DOM event with metadata
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('dexto:response', {
                                detail: {
                                    text: data.response,
                                    sessionId,
                                    tokenUsage: data.tokenUsage,
                                    timestamp: Date.now(),
                                },
                            })
                        );
                    }
                }
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    console.log('Stream aborted by user');
                    return;
                }

                console.error('Stream error:', error);
                setStatus(sessionId, 'closed');
                setProcessing(sessionId, false);

                setError(sessionId, {
                    id: generateUniqueId(),
                    message: error.message || 'Failed to send message',
                    timestamp: Date.now(),
                    context: 'stream',
                    recoverable: true,
                    sessionId,
                    anchorMessageId: userId,
                });
            }
        },
        [processEvent, abortSession, getAbortController, setProcessing, setStatus, setError]
    );

    const reset = useCallback(
        async (sessionId?: string) => {
            if (!sessionId) return;

            try {
                await client.api.reset.$post({
                    json: { sessionId },
                });
            } catch (e) {
                console.error('Failed to reset session', e);
            }

            setMessages([]);
            setError(sessionId, null);
            lastUserMessageIdRef.current = null;
            pendingToolCallsRef.current.clear();
            setProcessing(sessionId, false);
        },
        [setError, setProcessing]
    );

    const cancel = useCallback(
        (sessionId?: string) => {
            if (!sessionId) return;
            abortSession(sessionId);
            setProcessing(sessionId, false);
            setStatus(sessionId, 'closed');
            pendingToolCallsRef.current.clear();
            suppressNextErrorRef.current = true;
        },
        [abortSession, setProcessing, setStatus]
    );

    return {
        messages,
        sendMessage,
        reset,
        setMessages,
        cancel,
    };
}
