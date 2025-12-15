/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import type { DextoAgent, InternalMessage, ContentPart } from '@dexto/core';
import { isTextPart } from '@dexto/core';
import type { Message } from '../state/types.js';
import { generateMessageId } from './idGenerator.js';

/**
 * Tool-specific display configuration.
 * Controls how each tool is displayed in the UI - name, which args to show, etc.
 */
interface ToolDisplayConfig {
    /** User-friendly display name */
    displayName: string;
    /** Which args to display, in order */
    argsToShow: string[];
    /** Primary arg shown without key name (first in argsToShow) */
    primaryArg?: string;
}

/**
 * Per-tool display configurations.
 * Each tool specifies exactly which arguments to show and how.
 */
const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
    // File tools - show file_path as primary
    read_file: { displayName: 'Read', argsToShow: ['file_path'], primaryArg: 'file_path' },
    write_file: { displayName: 'Write', argsToShow: ['file_path'], primaryArg: 'file_path' },
    edit_file: { displayName: 'Update', argsToShow: ['file_path'], primaryArg: 'file_path' },

    // Search tools - show pattern as primary, path as secondary
    glob_files: { displayName: 'Glob', argsToShow: ['pattern', 'path'], primaryArg: 'pattern' },
    grep_content: { displayName: 'Search', argsToShow: ['pattern', 'path'], primaryArg: 'pattern' },

    // Bash - show command only, skip description
    bash_exec: { displayName: 'Bash', argsToShow: ['command'], primaryArg: 'command' },
    bash_output: {
        displayName: 'BashOutput',
        argsToShow: ['process_id'],
        primaryArg: 'process_id',
    },
    kill_process: { displayName: 'Kill', argsToShow: ['process_id'], primaryArg: 'process_id' },

    // User interaction
    ask_user: { displayName: 'Ask', argsToShow: ['question'], primaryArg: 'question' },
};

/**
 * Gets the display config for a tool.
 * Handles internal-- prefix by stripping it before lookup.
 */
function getToolConfig(toolName: string): ToolDisplayConfig | undefined {
    // Try direct lookup first
    if (TOOL_CONFIGS[toolName]) {
        return TOOL_CONFIGS[toolName];
    }
    // Strip internal-- prefix and try again
    if (toolName.startsWith('internal--')) {
        const baseName = toolName.replace('internal--', '');
        return TOOL_CONFIGS[baseName];
    }
    return undefined;
}

/**
 * Gets a user-friendly display name for a tool.
 * Returns the friendly name if known, otherwise returns the original name
 * with any "internal--" prefix stripped.
 * MCP tools keep their server prefix for clarity (e.g., "mcp_server__tool").
 */
export function getToolDisplayName(toolName: string): string {
    const config = getToolConfig(toolName);
    if (config) {
        return config.displayName;
    }
    // Strip "internal--" prefix for unknown internal tools
    if (toolName.startsWith('internal--')) {
        return toolName.replace('internal--', '');
    }
    // MCP tools keep their full name (server__tool format) for clarity
    return toolName;
}

/**
 * Fallback primary argument names for unknown tools.
 * Used when we don't have a specific config for a tool.
 */
const FALLBACK_PRIMARY_ARGS = new Set([
    'file_path',
    'path',
    'pattern',
    'command',
    'query',
    'question',
    'url',
]);

/**
 * Formats tool arguments for display in Claude Code style.
 * Format: ToolName(primary_arg) or ToolName(primary_arg, key: value)
 *
 * Uses tool-specific config to determine which args to show.
 * Primary argument is shown without key name.
 * Secondary arguments show key: value format.
 */
export function formatToolArgsForDisplay(
    toolName: string,
    args: Record<string, unknown>,
    maxLength: number = 70
): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    const config = getToolConfig(toolName);
    const parts: string[] = [];

    if (config) {
        // Use tool-specific config
        for (const argName of config.argsToShow) {
            if (!(argName in args)) continue;
            if (parts.length >= 3) break;

            const value = args[argName];
            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            const truncated = strValue.length > 40 ? strValue.slice(0, 37) + '...' : strValue;

            if (argName === config.primaryArg) {
                // Primary arg without key name
                parts.unshift(truncated);
            } else {
                // Secondary args with key name
                parts.push(`${argName}: ${truncated}`);
            }
        }
    } else {
        // Fallback for unknown tools (MCP, etc.)
        for (const [key, value] of entries) {
            if (parts.length >= 3) break;

            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            const truncated = strValue.length > 40 ? strValue.slice(0, 37) + '...' : strValue;

            if (FALLBACK_PRIMARY_ARGS.has(key)) {
                parts.unshift(truncated);
            } else {
                parts.push(`${key}: ${truncated}`);
            }
        }
    }

    const result = parts.join(', ');
    return result.length > maxLength ? result.slice(0, maxLength - 3) + '...' : result;
}

/**
 * Formats tool arguments for display (compact preview).
 * @deprecated Use formatToolArgsForDisplay instead
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
