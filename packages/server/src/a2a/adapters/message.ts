/**
 * A2A Message Format Converters
 *
 * Bidirectional conversion between A2A protocol message format
 * and Dexto's internal message format.
 *
 * These converters live at the server boundary, translating between
 * wire format (A2A) and internal format (DextoAgent).
 */

import type { InternalMessage } from '@dexto/core';
import type { Message, Part, MessageRole, ConvertedMessage } from '../types.js';
import { randomUUID } from 'crypto';

/**
 * Convert A2A message to internal format for agent.run().
 *
 * Extracts text, image, and file from A2A parts array.
 * agent.run() expects these as separate parameters.
 *
 * @param a2aMsg A2A protocol message
 * @returns Converted message parts for agent.run()
 */
export function a2aToInternalMessage(a2aMsg: Message): ConvertedMessage {
    let text = '';
    let image: ConvertedMessage['image'] | undefined;
    let file: ConvertedMessage['file'] | undefined;

    for (const part of a2aMsg.parts) {
        switch (part.kind) {
            case 'text':
                text += (text ? ' ' : '') + part.text;
                break;

            case 'file': {
                // Determine if this is an image or general file
                const fileData = part.file;
                const mimeType = fileData.mimeType || '';
                const isImage = mimeType.startsWith('image/');

                if (isImage && !image) {
                    // Treat as image (agent.run() supports one image)
                    const data = 'bytes' in fileData ? fileData.bytes : fileData.uri;
                    image = {
                        image: data,
                        mimeType: mimeType,
                    };
                } else if (!file) {
                    // Take first file only (agent.run() supports one file)
                    const data = 'bytes' in fileData ? fileData.bytes : fileData.uri;
                    const fileObj: { data: string; mimeType: string; filename?: string } = {
                        data: data,
                        mimeType: mimeType,
                    };
                    if (fileData.name) {
                        fileObj.filename = fileData.name;
                    }
                    file = fileObj;
                }
                break;
            }

            case 'data':
                // Convert structured data to JSON text
                text += (text ? '\n' : '') + JSON.stringify(part.data, null, 2);
                break;
        }
    }

    return { text, image, file };
}

/**
 * Convert internal message to A2A format.
 *
 * Maps Dexto's internal message structure to A2A protocol format.
 *
 * Role mapping:
 * - 'user' → 'user'
 * - 'assistant' → 'agent'
 * - 'system' → filtered out (not part of A2A conversation)
 * - 'tool' → 'agent' (tool results presented as agent responses)
 *
 * @param msg Internal message from session history
 * @param taskId Optional task ID to associate message with
 * @param contextId Optional context ID to associate message with
 * @returns A2A protocol message or null if message should be filtered
 */
export function internalToA2AMessage(
    msg: InternalMessage,
    taskId?: string,
    contextId?: string
): Message | null {
    // Filter out system messages (internal context, not part of A2A conversation)
    if (msg.role === 'system') {
        return null;
    }

    // Map role
    const role: MessageRole = msg.role === 'user' ? 'user' : 'agent';

    // Convert content to parts
    const parts: Part[] = [];

    if (typeof msg.content === 'string') {
        // Simple text content
        if (msg.content) {
            parts.push({ kind: 'text', text: msg.content });
        }
    } else if (msg.content === null) {
        // Null content (tool-only messages) - skip for A2A
        // These are internal details, not part of user-facing conversation
    } else if (Array.isArray(msg.content)) {
        // Multi-part content
        for (const part of msg.content) {
            switch (part.type) {
                case 'text':
                    parts.push({ kind: 'text', text: part.text });
                    break;

                case 'image':
                    parts.push({
                        kind: 'file',
                        file: {
                            bytes: part.image.toString(),
                            mimeType: part.mimeType || 'image/png',
                        },
                    });
                    break;

                case 'file': {
                    const fileObj: any = {
                        bytes: part.data.toString(),
                        mimeType: part.mimeType,
                    };
                    if (part.filename) {
                        fileObj.name = part.filename;
                    }
                    parts.push({
                        kind: 'file',
                        file: fileObj,
                    });
                    break;
                }
            }
        }
    }

    // If no parts, return null (don't include empty messages in A2A)
    if (parts.length === 0) {
        return null;
    }

    const message: Message = {
        role,
        parts,
        messageId: randomUUID(),
        kind: 'message',
    };

    if (taskId) message.taskId = taskId;
    if (contextId) message.contextId = contextId;

    return message;
}

/**
 * Convert array of internal messages to A2A messages.
 *
 * Filters out system messages and empty messages.
 *
 * @param messages Internal messages from session history
 * @param taskId Optional task ID to associate messages with
 * @param contextId Optional context ID to associate messages with
 * @returns Array of A2A protocol messages
 */
export function internalMessagesToA2A(
    messages: InternalMessage[],
    taskId?: string,
    contextId?: string
): Message[] {
    const a2aMessages: Message[] = [];

    for (const msg of messages) {
        const a2aMsg = internalToA2AMessage(msg, taskId, contextId);
        if (a2aMsg !== null) {
            a2aMessages.push(a2aMsg);
        }
    }

    return a2aMessages;
}
