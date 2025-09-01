// Add the client directive
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { TextPart as CoreTextPart, InternalMessage, FilePart } from '@core/context/types.js';
import { toError } from '@core/utils/error-conversion.js';
import { Issue } from '@core/errors/types.js';
import type { LLMRouter, LLMProvider } from '@core/llm/registry.js';

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

export interface ToolResultContent {
    content: Array<TextPart | ImagePart | AudioPart | FilePart>;
}

export type ToolResult = ToolResultError | ToolResultContent | string | Record<string, unknown>;

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
    toolResult?: ToolResult;
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

export function useChat(wsUrl: string, getActiveSessionId?: () => string | null) {
    const wsRef = useRef<globalThis.WebSocket | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);

    // Track the last user message id to anchor errors inline in the UI
    const lastUserMessageIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
    const [processing, setProcessing] = useState<boolean>(false);
    // Separate error state - not part of message flow
    const [activeError, setActiveError] = useState<ErrorMessage | null>(null);
    const suppressNextErrorRef = useRef<boolean>(false);

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

    useEffect(() => {
        const ws = new globalThis.WebSocket(wsUrl);

        wsRef.current = ws;
        ws.onopen = () => setStatus('open');
        ws.onclose = () => setStatus('closed');
        ws.onerror = (_evt) => {
            setStatus('closed');
            setActiveError({
                id: generateUniqueId(),
                message: 'Connection error. Please try again.',
                timestamp: Date.now(),
                context: 'websocket',
            });
        };
        ws.onmessage = (event: globalThis.MessageEvent) => {
            // TODO: Replace untyped WebSocket payloads with a shared, typed schema
            // Define a union for { event: 'chunk' | 'response' | ...; data: ... } and
            // use proper type guards instead of `any` casting here.
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch (err: unknown) {
                const error = toError(err);
                console.error(`[useChat] WebSocket message parse error: ${error.message}`, {
                    error,
                });
                return; // Skip malformed message
            }
            const payload = msg.data || {};
            switch (msg.event) {
                case 'thinking':
                    // Only handle events for the active session
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    setProcessing(true);
                    setMessages((ms) => [
                        ...ms,
                        {
                            id: generateUniqueId(),
                            role: 'system',
                            content: 'Dexto is thinking...',
                            createdAt: Date.now(),
                        },
                    ]);
                    break;
                case 'chunk': {
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    // All chunk types use payload.content
                    const text = typeof payload.content === 'string' ? payload.content : '';
                    if (!text) break;
                    const chunkType = payload.type as 'text' | 'reasoning' | undefined;

                    if (chunkType === 'reasoning') {
                        // Update reasoning on the last assistant message if present,
                        // otherwise create a placeholder assistant message to host the reasoning stream.
                        setMessages((ms) => {
                            const cleaned = ms.filter(
                                (m) =>
                                    !(m.role === 'system' && m.content === 'Dexto is thinking...')
                            );
                            const last = cleaned[cleaned.length - 1];
                            if (last && last.role === 'assistant') {
                                const updated = {
                                    ...last,
                                    reasoning: (last.reasoning || '') + text,
                                    createdAt: Date.now(),
                                };
                                return [...cleaned.slice(0, -1), updated];
                            }
                            // No assistant yet; create one with empty content and initial reasoning
                            return [
                                ...cleaned,
                                {
                                    id: generateUniqueId(),
                                    role: 'assistant',
                                    content: '',
                                    reasoning: text,
                                    createdAt: Date.now(),
                                },
                            ];
                        });
                    } else {
                        setMessages((ms) => {
                            // Remove any existing 'thinking' system messages
                            const cleaned = ms.filter(
                                (m) =>
                                    !(m.role === 'system' && m.content === 'Dexto is thinking...')
                            );
                            const last = cleaned[cleaned.length - 1];
                            if (last && last.role === 'assistant') {
                                // Ensure content is always a string for streaming
                                const currentContent =
                                    typeof last.content === 'string' ? last.content : '';
                                const newContent = currentContent + text;
                                const updated = {
                                    ...last,
                                    content: newContent,
                                    createdAt: Date.now(),
                                };
                                return [...cleaned.slice(0, -1), updated];
                            }
                            return [
                                ...cleaned,
                                {
                                    id: generateUniqueId(),
                                    role: 'assistant',
                                    content: text,
                                    createdAt: Date.now(),
                                },
                            ];
                        });
                    }
                    break;
                }
                case 'response': {
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    setProcessing(false);
                    const text = typeof payload.text === 'string' ? payload.text : '';
                    const reasoning =
                        typeof payload.reasoning === 'string' ? payload.reasoning : undefined;
                    const tokenUsage =
                        payload && typeof payload.tokenUsage === 'object'
                            ? (payload.tokenUsage as {
                                  inputTokens?: number;
                                  outputTokens?: number;
                                  reasoningTokens?: number;
                                  totalTokens?: number;
                              })
                            : undefined;
                    const model = typeof payload.model === 'string' ? payload.model : undefined;
                    const provider =
                        typeof payload.provider === 'string'
                            ? (payload.provider as LLMProvider)
                            : undefined;
                    const router = typeof payload.router === 'string' ? payload.router : undefined;
                    const sessionId =
                        typeof payload.sessionId === 'string' ? payload.sessionId : undefined;

                    setMessages((ms) => {
                        // Remove 'thinking' placeholders
                        const cleaned = ms.filter(
                            (m) => !(m.role === 'system' && m.content === 'Dexto is thinking...')
                        );

                        // Check if this response is updating an existing message
                        const lastMsg = cleaned[cleaned.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            // Update existing message with final content and metadata
                            // Ensure content is always a string for consistency
                            const finalContent = typeof text === 'string' ? text : '';
                            const updatedMsg: Message = {
                                ...lastMsg,
                                content: finalContent,
                                tokenUsage,
                                reasoning,
                                model,
                                provider,
                                router,
                                createdAt: Date.now(),
                                sessionId: sessionId ?? lastMsg.sessionId,
                            };
                            return [...cleaned.slice(0, -1), updatedMsg];
                        }

                        // Create new message if no existing assistant message
                        const newMsg: Message = {
                            id: generateUniqueId(),
                            role: 'assistant',
                            content: text,
                            createdAt: Date.now(),
                            tokenUsage,
                            reasoning,
                            model,
                            provider,
                            router,
                            sessionId,
                        };
                        return [...cleaned, newMsg];
                    });

                    // Emit DOM event for other components to listen to
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('dexto:response', {
                                detail: {
                                    text,
                                    sessionId,
                                    reasoning,
                                    tokenUsage,
                                    model,
                                    timestamp: Date.now(),
                                },
                            })
                        );
                    }

                    break;
                }
                case 'conversationReset':
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    setProcessing(false);
                    setMessages([]);
                    lastUserMessageIdRef.current = null;
                    break;
                case 'toolCall': {
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    const name = payload.toolName;
                    const args = payload.args;
                    setMessages((ms) => [
                        ...ms,
                        {
                            id: generateUniqueId(),
                            role: 'tool',
                            content: null,
                            toolName: name,
                            toolArgs: args,
                            createdAt: Date.now(),
                        },
                    ]);
                    break;
                }
                case 'toolResult': {
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    const name = payload.toolName;
                    const result = payload.result;

                    // Process and normalize the tool result to ensure proper image handling
                    let processedResult = result;

                    if (result && Array.isArray(result.content)) {
                        // Normalize media parts in tool result content
                        const normalizedContent = result.content.map((part: unknown) => {
                            if (
                                typeof part === 'object' &&
                                part !== null &&
                                (part as { type?: unknown }).type === 'image'
                            ) {
                                const imgPart = part as any;
                                // Ensure consistent format for image parts
                                if (imgPart.data && imgPart.mimeType) {
                                    return {
                                        type: 'image',
                                        base64: imgPart.data,
                                        mimeType: imgPart.mimeType,
                                    };
                                } else if (imgPart.base64 && imgPart.mimeType) {
                                    return {
                                        type: 'image',
                                        base64: imgPart.base64,
                                        mimeType: imgPart.mimeType,
                                    };
                                } else if (imgPart.image || imgPart.url) {
                                    return part; // Keep original format for URL-based images
                                }
                            } else if (
                                typeof part === 'object' &&
                                part !== null &&
                                (part as { type?: unknown }).type === 'audio'
                            ) {
                                const audioPart = part as any;
                                // Ensure consistent format for audio parts
                                if (audioPart.data && audioPart.mimeType) {
                                    return {
                                        type: 'audio',
                                        base64: audioPart.data,
                                        mimeType: audioPart.mimeType,
                                        filename: audioPart.filename,
                                    };
                                } else if (audioPart.base64 && audioPart.mimeType) {
                                    return {
                                        type: 'audio',
                                        base64: audioPart.base64,
                                        mimeType: audioPart.mimeType,
                                        filename: audioPart.filename,
                                    };
                                } else if (audioPart.audio || audioPart.url) {
                                    return part; // Keep original format for URL-based audio
                                }
                            }
                            return part;
                        });
                        processedResult = { ...result, content: normalizedContent };
                    }

                    // Merge toolResult into the existing toolCall message
                    setMessages((ms) => {
                        const idx = ms.findIndex(
                            (m) =>
                                m.role === 'tool' &&
                                m.toolName === name &&
                                m.toolResult === undefined
                        );
                        if (idx !== -1) {
                            const updatedMsg = { ...ms[idx], toolResult: processedResult };
                            return [...ms.slice(0, idx), updatedMsg, ...ms.slice(idx + 1)];
                        }
                        console.warn(`No matching tool call found for result of ${name}`);
                        // No matching toolCall found; do not append a new message
                        return ms;
                    });
                    break;
                }
                case 'toolConfirmationResponse': {
                    // No UI output needed; just ignore.
                    break;
                }
                case 'error': {
                    if (!isForActiveSession((payload as any).sessionId)) return;
                    setProcessing(false);
                    // TODO: Replace untyped WebSocket payloads with a shared, typed schema
                    // Define a union for { event: 'error'; data: DextoValidationError | DextoRuntimeError } and
                    // use proper type guards instead of manual payload inspection here.

                    // Clean up thinking messages first
                    setMessages((ms) =>
                        ms.filter(
                            (m) => !(m.role === 'system' && m.content === 'Dexto is thinking...')
                        )
                    );

                    // If we recently triggered cancel locally, suppress the next provider error
                    if (suppressNextErrorRef.current) {
                        suppressNextErrorRef.current = false;
                        break;
                    }

                    // If this is a user-initiated cancel, do not surface an error UI.
                    if (payload?.context === 'user_cancelled') {
                        break;
                    }

                    // Otherwise, set an error banner (separate from messages)
                    const errorMessage = toError(payload).message;
                    setActiveError({
                        id: generateUniqueId(),
                        message: errorMessage,
                        timestamp: Date.now(),
                        context: payload.context,
                        recoverable: payload.recoverable,
                        sessionId: payload.sessionId,
                        anchorMessageId: lastUserMessageIdRef.current || undefined,
                        detailedIssues: Array.isArray(payload.issues)
                            ? (payload.issues as Issue[])
                            : [],
                    });
                    break;
                }
                default:
                    break;
            }
        };
        return () => {
            ws.close();
        };
    }, [wsUrl]);

    const sendMessage = useCallback(
        (
            content: string,
            imageData?: { base64: string; mimeType: string },
            fileData?: FileData,
            sessionId?: string,
            stream = false
        ) => {
            if (wsRef.current?.readyState === globalThis.WebSocket.OPEN) {
                const message = {
                    type: 'message',
                    content,
                    imageData,
                    fileData,
                    sessionId,
                    stream,
                };
                wsRef.current.send(JSON.stringify(message));
                setProcessing(true);

                // Add user message to local state immediately
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

                // Emit DOM event for other components to listen to
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('dexto:message', {
                            detail: { content, sessionId, timestamp: Date.now() },
                        })
                    );
                }
            } else {
                setActiveError({
                    id: generateUniqueId(),
                    message: 'Cannot send message: connection is not open',
                    timestamp: Date.now(),
                    context: 'websocket',
                    recoverable: true,
                });
            }
        },
        []
    );

    const reset = useCallback((sessionId?: string) => {
        if (wsRef.current?.readyState === globalThis.WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'reset', sessionId }));
        }
        setMessages([]);
        setActiveError(null); // Clear errors on reset
        lastUserMessageIdRef.current = null;
        setProcessing(false);
    }, []);

    const cancel = useCallback((sessionId?: string) => {
        if (wsRef.current?.readyState === globalThis.WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'cancel', sessionId }));
        }
        // Optimistically clear processing state; server will also send events
        setProcessing(false);
        // Ensure any ensuing provider stream error from abort does not surface as banner
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
        websocket: wsRef.current,
        processing,
        cancel,
        // Error state
        activeError,
        clearError,
    };
}
