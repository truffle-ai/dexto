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

// Define a WebUI-specific audio part for tool results
export interface AudioPart {
    type: 'audio';
    data: string; // base64 audio data
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
    content: Array<TextPart | ImagePart | FilePart | AudioPart>;
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

export function isAudioPart(part: unknown): part is AudioPart {
    return (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type: unknown }).type === 'audio'
    );
}

// Extend core InternalMessage for WebUI
export interface Message extends Omit<InternalMessage, 'content'> {
    id: string;
    createdAt: number;
    content: string | null | Array<TextPart | ImagePart | AudioPart>;
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

// Helper function to filter media content from tool results for LLM context
function filterMediaFromToolResult(result: ToolResult): ToolResult {
    if (!result || typeof result !== 'object') {
        return result;
    }

    // Recursively filter large base64 strings from any object (same logic as core)
    const filterLargeBase64 = (obj: any): any => {
        if (typeof obj === 'string') {
            // If it's a base64 string longer than 1KB, truncate it
            // More permissive regex to catch various base64 formats
            if (
                obj.length > 1024 &&
                (/^[A-Za-z0-9+/]+={0,2}$/.test(obj) || /^[A-Za-z0-9_-]+$/.test(obj))
            ) {
                return `[Base64 data truncated - ${obj.length} chars]`;
            }
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => filterLargeBase64(item));
        }

        if (typeof obj === 'object' && obj !== null) {
            const filtered: any = {};
            for (const [key, value] of Object.entries(obj)) {
                // Special handling for 'data' field containing base64 audio
                if (key === 'data' && typeof value === 'string' && value.length > 1024) {
                    // More aggressive filtering for 'data' field - assume it's base64 if it's long
                    filtered[key] = `[Base64 audio data - ${value.length} chars]`;
                } else {
                    filtered[key] = filterLargeBase64(value);
                }
            }
            return filtered;
        }

        return obj;
    };

    // Handle structured content with array of parts
    if (isToolResultContent(result) && Array.isArray(result.content)) {
        const filteredContent = result.content
            .map((part) => {
                // COMPLETELY REMOVE audio parts from filtered results (they're already consumed by UI)
                if (isAudioPart(part)) {
                    return null; // Remove entirely
                }
                if (isFilePart(part) && part.mimeType.startsWith('audio/')) {
                    return null; // Remove entirely
                }

                // Filter any remaining base64 data in non-audio parts
                return filterLargeBase64(part);
            })
            .filter((part) => part !== null); // Remove null entries

        return { content: filteredContent };
    }

    // Apply general base64 filtering for any other structure
    return filterLargeBase64(result);
}

// Helper function to create a filtered message for LLM context
function createFilteredMessage(message: Message): Message {
    if (message.toolResult) {
        return {
            ...message,
            toolResult: filterMediaFromToolResult(message.toolResult),
        };
    }
    return message;
}

export function useChat(wsUrl: string) {
    const wsRef = useRef<globalThis.WebSocket | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    // Store the last toolResult image URI to attach to the next AI response
    const lastImageUriRef = useRef<string | null>(null);
    // Store the last toolResult audio data to attach to the next AI response
    const lastAudioDataRef = useRef<{ src: string; filename?: string; mimeType: string } | null>(
        null
    );
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
                            // Preserve existing content structure (text + audio/image parts)
                            let newContent: string | Array<TextPart | ImagePart | AudioPart>;

                            if (Array.isArray(last.content)) {
                                // If content is already an array (has audio/image parts), update the text part
                                const textPart = last.content.find(
                                    (part) => part.type === 'text'
                                ) as TextPart;
                                if (textPart) {
                                    // Update existing text part
                                    const updatedParts = last.content.map((part) =>
                                        part.type === 'text'
                                            ? { ...part, text: textPart.text + text }
                                            : part
                                    );
                                    newContent = updatedParts;
                                } else {
                                    // Add new text part to existing array
                                    newContent = [...last.content, { type: 'text', text }];
                                }
                            } else {
                                // If content is just a string, convert to array with text + audio/image parts
                                const hasImage = !!lastImageUriRef.current;
                                const hasAudio = !!lastAudioDataRef.current;

                                if (hasImage || hasAudio) {
                                    const parts: Array<TextPart | ImagePart | AudioPart> = [];

                                    // Add text part
                                    const existingText =
                                        typeof last.content === 'string' ? last.content : '';
                                    parts.push({ type: 'text', text: existingText + text });

                                    // Add image part if available
                                    if (lastImageUriRef.current) {
                                        const uri = lastImageUriRef.current;
                                        const [, base64] = uri.split(',');
                                        const mimeMatch = uri.match(/data:(.*);base64/);
                                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                                        parts.push({ type: 'image', base64, mimeType });
                                    }

                                    // Add audio part if available
                                    if (lastAudioDataRef.current) {
                                        const audioData = lastAudioDataRef.current;
                                        const [, base64] = audioData.src.split(',');
                                        const audioPart: AudioPart = {
                                            type: 'audio',
                                            data: base64,
                                            mimeType: audioData.mimeType,
                                            filename: audioData.filename,
                                        };
                                        parts.push(audioPart);
                                    }

                                    newContent = parts;
                                } else {
                                    // Just text content
                                    newContent =
                                        (typeof last.content === 'string' ? last.content : '') +
                                        text;
                                }
                            }

                            const updated = {
                                ...last,
                                content: newContent,
                                createdAt: Date.now(),
                            };
                            return [...cleaned.slice(0, -1), updated];
                        }

                        // Create new assistant message
                        const hasImage = !!lastImageUriRef.current;
                        const hasAudio = !!lastAudioDataRef.current;

                        let content: string | Array<TextPart | ImagePart | AudioPart> = text;

                        if (hasImage || hasAudio) {
                            const parts: Array<TextPart | ImagePart | AudioPart> = [];

                            // Add text part
                            parts.push({ type: 'text', text });

                            // Add image part if available
                            if (lastImageUriRef.current) {
                                const uri = lastImageUriRef.current;
                                const [, base64] = uri.split(',');
                                const mimeMatch = uri.match(/data:(.*);base64/);
                                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                                parts.push({ type: 'image', base64, mimeType });
                            }

                            // Add audio part if available
                            if (lastAudioDataRef.current) {
                                const audioData = lastAudioDataRef.current;
                                const [, base64] = audioData.src.split(',');
                                const audioPart: AudioPart = {
                                    type: 'audio',
                                    data: base64,
                                    mimeType: audioData.mimeType,
                                    filename: audioData.filename,
                                };
                                parts.push(audioPart);
                            }

                            content = parts;
                        }

                        return [
                            ...cleaned,
                            {
                                id: generateUniqueId(),
                                role: 'assistant',
                                content,
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
                        // Embed image and audio parts in content if available
                        let content: string | Array<TextPart | ImagePart | AudioPart> = text;
                        const hasImage = !!lastImageUriRef.current;
                        const hasAudio = !!lastAudioDataRef.current;

                        if (hasImage || hasAudio) {
                            const parts: Array<TextPart | ImagePart | AudioPart> = [];

                            // Add text part if present
                            if (text.trim()) {
                                parts.push({ type: 'text', text });
                            }

                            // Add image part if available
                            if (lastImageUriRef.current) {
                                const uri = lastImageUriRef.current;
                                const [, base64] = uri.split(',');
                                const mimeMatch = uri.match(/data:(.*);base64/);
                                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                                parts.push({ type: 'image', base64, mimeType });
                            }

                            // Add audio part if available
                            if (lastAudioDataRef.current) {
                                const audioData = lastAudioDataRef.current;
                                const [, base64] = audioData.src.split(',');
                                const audioPart: AudioPart = {
                                    type: 'audio',
                                    data: base64,
                                    mimeType: audioData.mimeType,
                                    filename: audioData.filename,
                                };
                                parts.push(audioPart);
                            }

                            content = parts;
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
                            // Preserve existing content structure when updating
                            let finalContent: string | Array<TextPart | ImagePart | AudioPart>;

                            if (Array.isArray(lastMsg.content)) {
                                // If existing content is an array (has audio/image parts), preserve it
                                // but update the text part with the final text
                                const textPart = lastMsg.content.find(
                                    (part) => part.type === 'text'
                                ) as TextPart;
                                if (textPart) {
                                    // Update existing text part with final text
                                    const updatedParts = lastMsg.content.map((part) =>
                                        part.type === 'text' ? { ...part, text } : part
                                    );
                                    finalContent = updatedParts;
                                } else {
                                    // Add new text part to existing array
                                    finalContent = [...lastMsg.content, { type: 'text', text }];
                                }
                            } else {
                                // If existing content is just a string, use the new content (which may include audio/image parts)
                                finalContent = content;
                            }

                            const updatedMsg: Message = {
                                ...lastMsg,
                                content: finalContent,
                                tokenCount,
                                model,
                                sessionId,
                                createdAt: Date.now(),
                            };
                            return [...cleaned.slice(0, -1), updatedMsg];
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

                    // Clear the last image and audio for the next message AFTER React renders
                    setTimeout(() => {
                        lastImageUriRef.current = null;
                        lastAudioDataRef.current = null;
                    }, 0);
                    break;
                }
                case 'conversationReset':
                    setMessages([]);
                    lastImageUriRef.current = null;
                    lastAudioDataRef.current = null;
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
                    // Extract image URI from tool result, supporting data+mimetype
                    let uri: string | null = null;
                    // Extract audio data from tool result for embedding in final response
                    let audioData: { src: string; filename?: string; mimeType: string } | null =
                        null;

                    if (result && Array.isArray(result.content)) {
                        // Look for image part
                        const imgPart = result.content.find(
                            (
                                p: unknown
                            ): p is {
                                type: 'image';
                                data?: string;
                                image?: string;
                                url?: string;
                                mimeType?: string;
                            } =>
                                typeof p === 'object' &&
                                p !== null &&
                                (p as { type?: unknown }).type === 'image' &&
                                ('data' in (p as Record<string, unknown>) ||
                                    'image' in (p as Record<string, unknown>) ||
                                    'url' in (p as Record<string, unknown>))
                        );
                        if (imgPart) {
                            if (imgPart.data && imgPart.mimeType) {
                                // Assemble data URI
                                uri = `data:${imgPart.mimeType};base64,${imgPart.data}`;
                            } else if (imgPart.image || imgPart.url) {
                                uri = imgPart.image || imgPart.url;
                            }
                        }

                        // Look for audio part
                        const audioPart = result.content.find(
                            (
                                p: unknown
                            ): p is {
                                type: 'audio';
                                data: string;
                                mimeType: string;
                                filename?: string;
                            } =>
                                typeof p === 'object' &&
                                p !== null &&
                                (p as { type?: unknown }).type === 'audio' &&
                                'data' in (p as Record<string, unknown>) &&
                                'mimeType' in (p as Record<string, unknown>)
                        );
                        if (audioPart) {
                            audioData = {
                                src: `data:${audioPart.mimeType};base64,${audioPart.data}`,
                                filename: audioPart.filename,
                                mimeType: audioPart.mimeType,
                            };
                        }

                        // Also check for file parts with audio mimeType
                        if (!audioData) {
                            const audioFilePart = result.content.find(
                                (
                                    p: unknown
                                ): p is {
                                    type: 'file';
                                    data: string;
                                    mimeType: string;
                                    filename?: string;
                                } =>
                                    typeof p === 'object' &&
                                    p !== null &&
                                    (p as { type?: unknown }).type === 'file' &&
                                    'data' in (p as Record<string, unknown>) &&
                                    'mimeType' in (p as Record<string, unknown>) &&
                                    typeof (p as Record<string, unknown>).mimeType === 'string' &&
                                    ((p as Record<string, unknown>).mimeType as string).startsWith(
                                        'audio/'
                                    )
                            );
                            if (audioFilePart) {
                                audioData = {
                                    src: `data:${audioFilePart.mimeType};base64,${audioFilePart.data}`,
                                    filename: audioFilePart.filename,
                                    mimeType: audioFilePart.mimeType,
                                };
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
                    lastAudioDataRef.current = audioData;

                    // Merge toolResult into the existing toolCall message
                    setMessages((ms) => {
                        const idx = ms.findIndex(
                            (m) =>
                                m.role === 'tool' &&
                                m.toolName === name &&
                                m.toolResult === undefined
                        );
                        if (idx !== -1) {
                            // Store the ORIGINAL result for UI display, but provide filtered version for LLM context
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
        lastAudioDataRef.current = null;
        lastUserMessageIdRef.current = null;
    }, []);

    const clearError = useCallback(() => {
        setActiveError(null);
    }, []);

    // Get messages with media content filtered for LLM context
    const getFilteredMessages = useCallback(() => {
        return messages.map(createFilteredMessage);
    }, [messages]);

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
        // Filtered messages for LLM context
        getFilteredMessages,
    };
}
