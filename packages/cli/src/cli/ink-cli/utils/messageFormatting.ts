/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import type { DextoAgent } from '@dexto/core';
import { getDextoPath, logger } from '@dexto/core';
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
 * Extracts text content from message content (handles string or content parts array)
 */
function extractTextContent(content: any): string {
    // Simple string content
    if (typeof content === 'string') {
        return content;
    }

    // Array of content parts (from Anthropic/OpenAI format)
    if (Array.isArray(content)) {
        return content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text || '')
            .join('\n');
    }

    // Fallback for unexpected formats
    return String(content);
}

/**
 * Converts session history messages to UI messages
 */
export function convertHistoryToUIMessages(history: any[], sessionId: string): Message[] {
    const uiMessages: Message[] = [];

    for (let index = 0; index < history.length; index++) {
        const msg = history[index];

        // Extract text content properly
        const textContent = extractTextContent(msg.content);

        // Skip empty messages
        if (!textContent) continue;

        uiMessages.push({
            id: `session-${sessionId}-${index}`,
            role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
            content: textContent,
            timestamp: new Date(msg.timestamp || Date.now() - (history.length - index) * 1000),
        });
    }

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
