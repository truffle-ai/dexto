/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import type { Message } from '../state/types.js';

/**
 * Creates a user message
 */
export function createUserMessage(content: string): Message {
    return {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
    };
}

/**
 * Creates a system message
 */
export function createSystemMessage(content: string): Message {
    return {
        id: `system-${Date.now()}`,
        role: 'system',
        content,
        timestamp: new Date(),
    };
}

/**
 * Creates an error message
 */
export function createErrorMessage(error: Error | string): Message {
    const content = error instanceof Error ? error.message : error;
    return {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `❌ Error: ${content}`,
        timestamp: new Date(),
    };
}

/**
 * Creates a tool call message
 */
export function createToolMessage(toolName: string): Message {
    return {
        id: `tool-${Date.now()}`,
        role: 'tool',
        content: `🔧 Calling tool: ${toolName}`,
        timestamp: new Date(),
    };
}

/**
 * Formats a streaming placeholder message
 */
export function createStreamingMessage(): Message {
    return {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
    };
}
