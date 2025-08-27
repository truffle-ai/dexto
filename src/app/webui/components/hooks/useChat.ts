// Add the client directive
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { TextPart as CoreTextPart, InternalMessage, FilePart } from '@core/context/types.js';
import { extractErrorMessage } from '@core/utils/error-conversion.js';

// Reuse the identical TextPart from core
export type TextPart = CoreTextPart;

// Define a WebUI-specific image part
export interface ImagePart {
    type: 'image';
    base64: string;
    mimeType: string;
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
    content: Array<TextPart | ImagePart | FilePart>;
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
    content: string | null | Array<TextPart | ImagePart>;
    imageData?: { base64: string; mimeType: string };
    fileData?: FileData;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: ToolResult;
    tokenCount?: number;
    model?: string;
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
}

const generateUniqueId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export function useChat(wsUrl: string) {
    const wsRef = useRef<globalThis.WebSocket | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    // Store the last toolResult image URI to attach to the next AI response
    const lastImageUriRef = useRef<string | null>(null);
    // Track the last user message id to anchor errors inline in the UI
    const lastUserMessageIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
    // Separate error state - not part of message flow
    const [activeError, setActiveError] = useState<ErrorMessage | null>(null);

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
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch (err: unknown) {
                const em = extractErrorMessage(err);
                console.error(`[useChat] WebSocket message parse error: ${em}`);
                return; // Skip malformed message
            }
            const payload = msg.data || {};
            switch (msg.event) {
                case 'thinking':
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
                    const text = typeof payload.text === 'string' ? payload.text : '';
                    setMessages((ms) => {
                        // Remove any existing 'thinking' system messages
                        const cleaned = ms.filter(
                            (m) => !(m.role === 'system' && m.content === 'Dexto is thinking...')
                        );
                        const last = cleaned[cleaned.length - 1];
                        if (last && last.role === 'assistant') {
                            // Handle both string and array content types
                            let newContent: string | Array<TextPart | ImagePart>;
                            if (typeof last.content === 'string') {
                                newContent = last.content + text;
                            } else if (Array.isArray(last.content)) {
                                // If content is an array, update the text part or add a new text part
                                const textPart = last.content.find((part) =>
                                    isTextPart(part)
                                ) as TextPart;
                                if (textPart) {
                                    // Update existing text part
                                    newContent = last.content.map((part) =>
                                        isTextPart(part)
                                            ? { ...part, text: part.text + text }
                                            : part
                                    );
                                } else {
                                    // Add new text part
                                    newContent = [...last.content, { type: 'text', text }];
                                }
                            } else {
                                newContent = text;
                            }
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
                    break;
                }
                case 'response': {
                    const text = typeof payload.text === 'string' ? payload.text : '';
                    const tokenCount =
                        typeof payload.tokenCount === 'number' ? payload.tokenCount : undefined;
                    const model = typeof payload.model === 'string' ? payload.model : undefined;
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
                            let updatedContent: string | Array<TextPart | ImagePart>;

                            if (lastImageUriRef.current) {
                                // Handle image content
                                const uri = lastImageUriRef.current;
                                const [, base64] = uri.split(',');
                                const mimeMatch = uri.match(/data:(.*);base64/);
                                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                                const imagePart: ImagePart = { type: 'image', base64, mimeType };

                                if (typeof lastMsg.content === 'string') {
                                    // Convert string content to array with text and image
                                    updatedContent = text.trim()
                                        ? [{ type: 'text', text }, imagePart]
                                        : [imagePart];
                                } else if (Array.isArray(lastMsg.content)) {
                                    // Update existing array content
                                    const textPart = lastMsg.content.find((part) =>
                                        isTextPart(part)
                                    ) as TextPart;
                                    if (textPart) {
                                        // Update existing text part and ensure image part exists
                                        const updatedParts = lastMsg.content.map((part) =>
                                            isTextPart(part) ? { ...part, text } : part
                                        );
                                        const hasImage = updatedParts.some((part) =>
                                            isImagePart(part)
                                        );
                                        if (!hasImage) {
                                            updatedParts.push(imagePart);
                                        }
                                        updatedContent = updatedParts;
                                    } else {
                                        // Add text part and image part
                                        updatedContent = text.trim()
                                            ? [{ type: 'text', text }, imagePart]
                                            : [imagePart];
                                    }
                                } else {
                                    updatedContent = text.trim()
                                        ? [{ type: 'text', text }, imagePart]
                                        : [imagePart];
                                }
                            } else {
                                // No image, just use text content
                                updatedContent = text;
                            }

                            const updatedMsg = {
                                ...lastMsg,
                                content: updatedContent,
                                tokenCount,
                                model,
                                createdAt: Date.now(),
                            };
                            return [...cleaned.slice(0, -1), updatedMsg];
                        }

                        // Create new message if no existing assistant message
                        let content: string | Array<TextPart | ImagePart> = text;
                        if (lastImageUriRef.current) {
                            const uri = lastImageUriRef.current;
                            const [, base64] = uri.split(',');
                            const mimeMatch = uri.match(/data:(.*);base64/);
                            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                            const imagePart: ImagePart = { type: 'image', base64, mimeType };
                            content = text.trim()
                                ? [{ type: 'text', text }, imagePart]
                                : [imagePart];
                        }

                        const newMsg: Message = {
                            id: generateUniqueId(),
                            role: 'assistant',
                            content,
                            createdAt: Date.now(),
                            tokenCount,
                            model,
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
                                    tokenCount,
                                    model,
                                    timestamp: Date.now(),
                                },
                            })
                        );
                    }

                    // Clear the last image for the next message
                    lastImageUriRef.current = null;
                    break;
                }
                case 'conversationReset':
                    setMessages([]);
                    lastImageUriRef.current = null;
                    lastUserMessageIdRef.current = null;
                    break;
                case 'toolCall': {
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
                    const name = payload.toolName;
                    const result = payload.result;

                    // Process and normalize the tool result to ensure proper image handling
                    let processedResult = result;

                    // Extract image URI from tool result for potential use in AI response
                    let uri: string | null = null;
                    if (result && Array.isArray(result.content)) {
                        // Normalize image parts in tool result content
                        const normalizedContent = result.content.map((part: unknown) => {
                            if (
                                typeof part === 'object' &&
                                part !== null &&
                                (part as { type?: unknown }).type === 'image'
                            ) {
                                const imgPart = part as any;
                                // Ensure consistent format for image parts
                                if (imgPart.data && imgPart.mimeType) {
                                    uri = `data:${imgPart.mimeType};base64,${imgPart.data}`;
                                    return {
                                        type: 'image',
                                        base64: imgPart.data,
                                        mimeType: imgPart.mimeType,
                                    };
                                } else if (imgPart.base64 && imgPart.mimeType) {
                                    uri = `data:${imgPart.mimeType};base64,${imgPart.base64}`;
                                    return {
                                        type: 'image',
                                        base64: imgPart.base64,
                                        mimeType: imgPart.mimeType,
                                    };
                                } else if (imgPart.image || imgPart.url) {
                                    uri = imgPart.image || imgPart.url;
                                    return part; // Keep original format for URL-based images
                                }
                            }
                            return part;
                        });
                        processedResult = { ...result, content: normalizedContent };
                    } else if (typeof result === 'string' && result.startsWith('data:image')) {
                        uri = result;
                    } else if (result && typeof result === 'object') {
                        // Handle legacy image formats
                        if ('data' in result && 'mimeType' in result) {
                            uri = `data:${result.mimeType};base64,${result.data}`;
                        } else if (result.screenshot) {
                            uri = result.screenshot;
                        } else if (result.image) {
                            uri = result.image;
                        } else if (result.url && String(result.url).startsWith('data:image')) {
                            uri = result.url;
                        }
                    }

                    // Store image URI for potential use in AI response
                    lastImageUriRef.current = uri;

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
                    // Extract meaningful error messages from potentially nested error payloads
                    const errMsg = extractErrorMessage(payload);

                    // Clean up thinking messages like other terminal events
                    setMessages((ms) =>
                        ms.filter(
                            (m) => !(m.role === 'system' && m.content === 'Dexto is thinking...')
                        )
                    );

                    // Set error as separate state, not as a message
                    setActiveError({
                        id: generateUniqueId(),
                        message: errMsg,
                        timestamp: Date.now(),
                        context: payload.context,
                        recoverable: payload.recoverable,
                        sessionId: payload.sessionId,
                        anchorMessageId: lastUserMessageIdRef.current || undefined,
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
        lastImageUriRef.current = null;
        lastUserMessageIdRef.current = null;
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
        // Error state
        activeError,
        clearError,
    };
}
