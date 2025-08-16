// Add the client directive
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { TextPart as CoreTextPart, InternalMessage, FilePart } from '@core/context/types.js';

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

const generateUniqueId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export function useChat(wsUrl: string) {
    const wsRef = useRef<globalThis.WebSocket | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    // Store the last toolResult image URI to attach to the next AI response
    const lastImageUriRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

    useEffect(() => {
        const ws = new globalThis.WebSocket(wsUrl);

        wsRef.current = ws;
        ws.onopen = () => setStatus('open');
        ws.onclose = () => setStatus('closed');
        ws.onmessage = (event: globalThis.MessageEvent) => {
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch (err: any) {
                console.error('WebSocket message parse error:', event.data, err);
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
                            // Only concatenate if existing content is a string
                            const newContent =
                                typeof last.content === 'string' ? last.content + text : text;
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
                        // Embed image part in content if available
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
                        // Prepare new AI message
                        const newMsg: Message = {
                            id: generateUniqueId(),
                            role: 'assistant',
                            content,
                            createdAt: Date.now(),
                            tokenCount,
                            model,
                            sessionId,
                        };
                        // Check if this response is updating an existing message
                        const lastMsg = cleaned[cleaned.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            return [...cleaned.slice(0, -1), newMsg];
                        }
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
                    // Extract image URI from tool result, supporting data+mimetype
                    let uri: string | null = null;
                    if (result && Array.isArray(result.content)) {
                        const imgPart: any = result.content.find(
                            (p: any) => p.type === 'image' && (p.data || p.image || p.url)
                        );
                        if (imgPart) {
                            if (imgPart.data && imgPart.mimeType) {
                                // Assemble data URI
                                uri = `data:${imgPart.mimeType};base64,${imgPart.data}`;
                            } else if (imgPart.image || imgPart.url) {
                                uri = imgPart.image || imgPart.url;
                            }
                        }
                    } else if (typeof result === 'string' && result.startsWith('data:image')) {
                        uri = result;
                    } else if (result && typeof result === 'object') {
                        // Older or fallback image fields
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
                            const updatedMsg = { ...ms[idx], toolResult: result };
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
                    // Ensure that error messages are always rendered as readable text.
                    const rawMsg = payload.message ?? 'Unknown error';
                    const errMsg =
                        typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg, null, 2);

                    setMessages((ms) => [
                        ...ms,
                        {
                            id: generateUniqueId(),
                            role: 'system',
                            content: errMsg,
                            createdAt: Date.now(),
                        },
                    ]);
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
                setMessages((ms) => [
                    ...ms,
                    {
                        id: generateUniqueId(),
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
            }
        },
        []
    );

    const reset = useCallback((sessionId?: string) => {
        if (wsRef.current?.readyState === globalThis.WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'reset', sessionId }));
        }
        setMessages([]);
    }, []);

    return { messages, status, sendMessage, reset, setMessages, websocket: wsRef.current };
}
