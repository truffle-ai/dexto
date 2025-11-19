// Add the client directive
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import type {
    TextPart as CoreTextPart,
    ImagePart as CoreImagePart,
    InternalMessage,
    FilePart,
    Issue,
    SanitizedToolResult,
} from '@dexto/core';
import { toError } from '@dexto/core';
import type { LLMRouter, LLMProvider } from '@dexto/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { EventStreamClient, SSEEvent } from '../../lib/EventStreamClient';
import { getApiUrl } from '../../lib/api-url';

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

const generateUniqueId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export function useChat(apiUrl: string, getActiveSessionId?: () => string | null) {
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    // Ref for aborting current stream
    const abortControllerRef = useRef<AbortController | null>(null);

    const [messages, setMessages] = useState<Message[]>([]);

    // Track the last user message id to anchor errors inline in the UI
    const lastUserMessageIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
    const [processing, setProcessing] = useState<boolean>(false);
    // Separate error state - not part of message flow
    const [activeError, setActiveError] = useState<ErrorMessage | null>(null);
    const suppressNextErrorRef = useRef<boolean>(false);
    // Map callId to message index for O(1) tool result pairing
    const pendingToolCallsRef = useRef<Map<string, number>>(new Map());

    // Keep analytics ref updated
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // Track the active session id from the host (ChatContext)
    const activeSessionGetterRef = useRef<(() => string | null) | undefined>(getActiveSessionId);
    useEffect(() => {
        activeSessionGetterRef.current = getActiveSessionId;
    }, [getActiveSessionId]);

    const isForActiveSession = useCallback((sessionId?: string): boolean => {
        if (!sessionId) return false;
        const getter = activeSessionGetterRef.current;
        const current = getter ? getter() : null;
        return !!current && sessionId === current;
    }, []);

    const processEvent = useCallback(
        (event: SSEEvent) => {
            if (!event.data) return;

            let payload: any;
            try {
                payload = JSON.parse(event.data);
            } catch (e) {
                console.error('Failed to parse event data', e);
                return;
            }

            const eventType = event.event;

            // Check session match
            if (payload.sessionId && !isForActiveSession(payload.sessionId)) {
                return;
            }

            switch (eventType) {
                case 'llm:thinking':
                    // LLM started thinking - can update UI status
                    setProcessing(true);
                    setStatus('open');
                    break;

                case 'llm:chunk': {
                    const text = payload.content || '';
                    const chunkType = payload.chunkType;

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
                    setProcessing(false);
                    const text = payload.content || '';
                    const usage = payload.tokenUsage;

                    setMessages((ms) => {
                        const lastMsg = ms[ms.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            const finalContent = typeof text === 'string' ? text : '';
                            const updatedMsg: Message = {
                                ...lastMsg,
                                content: finalContent,
                                tokenUsage: usage,
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
                                    sessionId: payload.sessionId,
                                    tokenUsage: usage,
                                    timestamp: Date.now(),
                                },
                            })
                        );
                    }
                    break;
                }

                case 'llm:tool-call': {
                    const { toolName, args, callId } = payload;
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
                    const { callId, success, sanitized, toolName } = payload;
                    const result = sanitized; // Core events use 'sanitized' field

                    // Track tool call completion
                    if (toolName) {
                        analyticsRef.current.trackToolCalled({
                            toolName,
                            success: success !== false,
                            sessionId: payload.sessionId,
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
                    if (typeof window !== 'undefined' && payload) {
                        window.dispatchEvent(
                            new CustomEvent('approval:request', {
                                detail: {
                                    approvalId: payload.approvalId,
                                    type: payload.type, // Use 'type' field from event bus
                                    timestamp: payload.timestamp,
                                    metadata: payload.metadata,
                                    sessionId: payload.sessionId,
                                },
                            })
                        );
                    }
                    break;
                }

                case 'approval:response': {
                    // Dispatch event for ToolConfirmationHandler to handle timeout/cancellation
                    if (typeof window !== 'undefined' && payload) {
                        window.dispatchEvent(
                            new CustomEvent('approval:response', {
                                detail: {
                                    approvalId: payload.approvalId,
                                    status: payload.status,
                                    reason: payload.reason,
                                    message: payload.message,
                                    sessionId: payload.sessionId,
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

                    const errorObj = payload.error || {};
                    const message = errorObj.message || 'Unknown error';

                    setActiveError({
                        id: generateUniqueId(),
                        message,
                        timestamp: Date.now(),
                        recoverable: payload.recoverable,
                        sessionId: payload.sessionId,
                        anchorMessageId: lastUserMessageIdRef.current || undefined,
                    });
                    setProcessing(false);
                    setStatus('closed');
                    break;
                }

                // Handle legacy events if server still sends them or mapped differently?
                // No, we are using new SSE stream.
            }
        },
        [isForActiveSession]
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
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            setProcessing(true);
            setStatus('connecting');

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
                    new CustomEvent('message', {
                        detail: { content, sessionId, timestamp: Date.now() },
                    })
                );
            }

            try {
                const client = new EventStreamClient();

                // 1. POST to get stream URL
                const response = await fetch(`${apiUrl}/api/message-stream`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: content,
                        sessionId,
                        imageData,
                        fileData,
                        stream: true,
                    }),
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    throw new Error(`Failed to send message: ${response.statusText}`);
                }

                const { streamUrl } = await response.json();
                // streamUrl is relative, e.g., /api/message-stream/xyz
                const fullStreamUrl = `${apiUrl}${streamUrl}`;

                // 2. Connect to SSE stream
                const iterator = await client.connect(fullStreamUrl, {
                    signal: abortController.signal,
                });

                setStatus('open');

                for await (const event of iterator) {
                    processEvent(event);
                }

                setStatus('closed');
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    console.log('Stream aborted by user');
                    return;
                }

                console.error('Stream error:', error);
                setStatus('closed');
                setProcessing(false);

                setActiveError({
                    id: generateUniqueId(),
                    message: error.message || 'Failed to send message',
                    timestamp: Date.now(),
                    context: 'stream',
                    recoverable: true,
                    sessionId,
                    anchorMessageId: userId,
                });
            } finally {
                abortControllerRef.current = null;
            }
        },
        [apiUrl, processEvent]
    );

    const reset = useCallback(
        async (sessionId?: string) => {
            if (!sessionId) return;

            try {
                await fetch(`${apiUrl}/api/reset`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId }),
                });
            } catch (e) {
                console.error('Failed to reset session', e);
            }

            setMessages([]);
            setActiveError(null);
            lastUserMessageIdRef.current = null;
            pendingToolCallsRef.current.clear();
            setProcessing(false);
        },
        [apiUrl]
    );

    const cancel = useCallback((sessionId?: string) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setProcessing(false);
        pendingToolCallsRef.current.clear();
        suppressNextErrorRef.current = true;
    }, []);

    const clearError = useCallback(() => {
        setActiveError(null);
    }, []);

    return {
        messages,
        status,
        sendMessage,
        reset,
        setMessages,
        processing,
        cancel,
        activeError,
        clearError,
    };
}
