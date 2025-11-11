/**
 * Message management service
 * Handles message creation and formatting
 */

import type { Message } from '../state/types.js';
import {
    createUserMessage,
    createSystemMessage,
    createErrorMessage,
    createToolMessage,
    createStreamingMessage,
} from '../utils/messageFormatting.js';

/**
 * Service for managing messages
 */
export class MessageService {
    /**
     * Creates a user message
     */
    createUserMessage(content: string): Message {
        return createUserMessage(content);
    }

    /**
     * Creates a system message
     */
    createSystemMessage(content: string): Message {
        return createSystemMessage(content);
    }

    /**
     * Creates an error message
     */
    createErrorMessage(error: Error | string): Message {
        return createErrorMessage(error);
    }

    /**
     * Creates a tool call message
     */
    createToolMessage(toolName: string): Message {
        return createToolMessage(toolName);
    }

    /**
     * Creates a streaming placeholder message
     */
    createStreamingMessage(): Message {
        return createStreamingMessage();
    }

    /**
     * Gets visible messages (for performance - limit to recent messages)
     */
    getVisibleMessages(messages: Message[], limit: number = 50): Message[] {
        if (limit <= 0) {
            return [];
        }
        return messages.slice(-limit);
    }
}
