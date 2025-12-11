/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import type { DextoAgent, InternalMessage, ContentPart } from '@dexto/core';
import { getDextoPath, logger, isTextPart } from '@dexto/core';
import type { Message } from '../state/types.js';
import { generateMessageId } from './idGenerator.js';

/**
 * Creates a user message
 */
export function createUserMessage(content: string): Message {
    return {
        id: generateMessageId('user'),
        role: 'user',
        content,
        timestamp: new Date(),
    };
}

/**
 * Creates a queued user message (shown when message is queued while processing)
 */
export function createQueuedUserMessage(content: string, queuePosition: number): Message {
    return {
        id: generateMessageId('user-queued'),
        role: 'user',
        content,
        timestamp: new Date(),
        isQueued: true,
        queuePosition,
    };
}

/**
 * Creates a system message
 */
export function createSystemMessage(content: string): Message {
    return {
        id: generateMessageId('system'),
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
        id: generateMessageId('error'),
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
        id: generateMessageId('tool'),
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
        id: generateMessageId('assistant'),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
    };
}

/**
 * Extracts text content from message content (handles ContentPart array or null)
 */
function extractTextContent(content: ContentPart[] | null): string {
    if (!content) {
        return '';
    }

    return content
        .filter(isTextPart)
        .map((part) => part.text)
        .join('\n');
}

/**
 * Converts session history messages to UI messages
 */
export function convertHistoryToUIMessages(
    history: InternalMessage[],
    sessionId: string
): Message[] {
    const uiMessages: Message[] = [];

    history.forEach((msg, index) => {
        // Extract text content properly
        const textContent = extractTextContent(msg.content);

        // Skip empty messages
        if (!textContent) return;

        uiMessages.push({
            id: `session-${sessionId}-${index}`,
            role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
            content: textContent,
            timestamp: new Date(msg.timestamp || Date.now() - (history.length - index) * 1000),
        });
    });

    return uiMessages;
}

/**
 * Collects startup information for display in header
 */
export async function getStartupInfo(agent: DextoAgent) {
    const connectedServers = agent.mcpManager.getClients();
    const failedConnections = agent.mcpManager.getFailedConnections();
    const tools = await agent.getAllTools();
    const toolCount = Object.keys(tools).length;
    const logFile = logger.getLogFilePath() || getDextoPath('logs', 'dexto.log');

    return {
        connectedServers: {
            count: connectedServers.size,
            names: Array.from(connectedServers.keys()),
        },
        failedConnections: Object.keys(failedConnections),
        toolCount,
        logFile,
    };
}
