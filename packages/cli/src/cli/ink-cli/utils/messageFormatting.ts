/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import type { DextoAgent, InternalMessage, ContentPart } from '@dexto/core';
import { isTextPart } from '@dexto/core';
import type { Message } from '../state/types.js';
import { generateMessageId } from './idGenerator.js';

/**
 * Mapping of internal tool names to user-friendly display names.
 * Similar to how Claude Code shows "Search" instead of "Grep".
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    // Internal file tools
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    glob_files: 'Glob',
    grep_content: 'Search',
    // Internal process tools
    bash_exec: 'Bash',
    bash_output: 'BashOutput',
    kill_process: 'Kill',
    // Internal user interaction
    ask_user: 'Ask',
    // Prefixed versions (internal-- prefix)
    'internal--read_file': 'Read',
    'internal--write_file': 'Write',
    'internal--edit_file': 'Edit',
    'internal--glob_files': 'Glob',
    'internal--grep_content': 'Search',
    'internal--bash_exec': 'Bash',
    'internal--bash_output': 'BashOutput',
    'internal--kill_process': 'Kill',
    'internal--ask_user': 'Ask',
};

/**
 * Gets a user-friendly display name for a tool.
 * Returns the friendly name if known, otherwise returns the original name
 * with any "internal--" prefix stripped.
 * MCP tools keep their server prefix for clarity (e.g., "mcp_server__tool").
 */
export function getToolDisplayName(toolName: string): string {
    // Check if we have a friendly name mapping
    if (TOOL_DISPLAY_NAMES[toolName]) {
        return TOOL_DISPLAY_NAMES[toolName];
    }
    // Strip "internal--" prefix for unknown internal tools
    if (toolName.startsWith('internal--')) {
        return toolName.replace('internal--', '');
    }
    // MCP tools keep their full name (server__tool format) for clarity
    return toolName;
}

/**
 * Formats tool arguments for display (compact preview).
 */
export function formatToolArgsPreview(
    args: Record<string, unknown>,
    maxLength: number = 60
): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    // Show key parameters in a compact format
    const preview = entries
        .slice(0, 3) // Max 3 params
        .map(([key, value]) => {
            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            const truncated = strValue.length > 30 ? strValue.slice(0, 27) + '...' : strValue;
            return `${key}: "${truncated}"`;
        })
        .join(', ');

    return preview.length > maxLength ? preview.slice(0, maxLength - 3) + '...' : preview;
}

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
    // Use agent's logger which has the correct per-agent log path from enriched config
    const logFile = agent.logger.getLogFilePath();

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
