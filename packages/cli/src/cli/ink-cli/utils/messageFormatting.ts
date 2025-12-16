/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import path from 'path';
import os from 'os';
import type { DextoAgent, InternalMessage, ContentPart } from '@dexto/core';
import { isTextPart } from '@dexto/core';
import type { Message } from '../state/types.js';
import { generateMessageId } from './idGenerator.js';

/**
 * Convert absolute path to display-friendly relative path.
 * Strategy (inspired by gemini-cli and codex):
 * 1. If path is under cwd → relative from cwd (e.g., "src/file.ts")
 * 2. If path is under home → use tilde (e.g., "~/Projects/file.ts")
 * 3. Otherwise → return absolute path
 */
export function makeRelativePath(absolutePath: string, cwd: string = process.cwd()): string {
    // Normalize paths for comparison
    const normalizedPath = path.normalize(absolutePath);
    const normalizedCwd = path.normalize(cwd);
    const homeDir = os.homedir();

    // If under cwd, return relative path
    if (normalizedPath.startsWith(normalizedCwd + path.sep) || normalizedPath === normalizedCwd) {
        const relative = path.relative(normalizedCwd, normalizedPath);
        return relative || '.';
    }

    // If under home directory, use tilde
    if (normalizedPath.startsWith(homeDir + path.sep) || normalizedPath === homeDir) {
        return '~' + normalizedPath.slice(homeDir.length);
    }

    // Return absolute path as-is
    return absolutePath;
}

/**
 * Format a path for display: relative + center-truncate if needed.
 * @param absolutePath - The absolute file path
 * @param maxWidth - Maximum display width (default 60)
 * @param cwd - Current working directory for relative path calculation
 */
export function formatPathForDisplay(
    absolutePath: string,
    maxWidth: number = 60,
    cwd: string = process.cwd()
): string {
    // First convert to relative
    const relativePath = makeRelativePath(absolutePath, cwd);

    // If fits, return as-is
    if (relativePath.length <= maxWidth) {
        return relativePath;
    }

    // Apply center-truncation
    return centerTruncatePath(relativePath, maxWidth);
}

/**
 * Center-truncate a file path to keep the filename visible.
 * e.g., "/Users/karaj/Projects/very/long/path/to/file.ts" → "/Users/karaj/…/to/file.ts"
 *
 * Strategy (inspired by codex):
 * 1. If path fits within maxWidth, return as-is
 * 2. Keep first segment (root/home) and last 2 segments (parent + filename)
 * 3. Add "…" in the middle
 */
export function centerTruncatePath(filePath: string, maxWidth: number): string {
    if (filePath.length <= maxWidth) {
        return filePath;
    }

    const sep = path.sep;
    const segments = filePath.split(sep).filter(Boolean);

    if (segments.length <= 3) {
        // Too few segments to center-truncate, just end-truncate
        return filePath.slice(0, maxWidth - 1) + '…';
    }

    // Keep first segment and last 2 segments
    const first = filePath.startsWith(sep) ? sep + segments[0] : segments[0];
    const lastTwo = segments.slice(-2).join(sep);

    const truncated = `${first}${sep}…${sep}${lastTwo}`;

    if (truncated.length <= maxWidth) {
        return truncated;
    }

    // Still too long - try with just the filename
    const filename = segments[segments.length - 1] || '';
    const withJustFilename = `…${sep}${filename}`;

    if (withJustFilename.length <= maxWidth) {
        return withJustFilename;
    }

    // Filename itself is too long, end-truncate it
    return filename.slice(0, maxWidth - 1) + '…';
}

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
    glob_files: {
        displayName: 'Find files',
        argsToShow: ['pattern', 'path'],
        primaryArg: 'pattern',
    },
    grep_content: {
        displayName: 'Search files',
        argsToShow: ['pattern', 'path'],
        primaryArg: 'pattern',
    },

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
 * Arguments that are file paths and should use relative path formatting.
 * These get converted to relative paths and center-truncated if needed.
 */
const PATH_ARGS = new Set(['file_path', 'path']);

/**
 * Arguments that should never be truncated (urls, etc.)
 * These provide important context that users need to see in full.
 * Note: 'command' is handled specially - single-line commands are not truncated,
 * but multi-line commands (heredocs) are truncated to first line only.
 */
const NEVER_TRUNCATE_ARGS = new Set(['url']);

/**
 * Formats tool arguments for display in Claude Code style.
 * Format: ToolName(primary_arg) or ToolName(primary_arg, key: value)
 *
 * Uses tool-specific config to determine which args to show.
 * - File paths: converted to relative paths, center-truncated if needed
 * - Commands/URLs: shown in full (never truncated)
 * - Other args: truncated at 40 chars
 */
export function formatToolArgsForDisplay(toolName: string, args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';

    const config = getToolConfig(toolName);
    const parts: string[] = [];

    /**
     * Format a single argument value for display
     */
    const formatArgValue = (argName: string, value: unknown): string => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);

        // File paths: use relative path + center-truncation
        if (PATH_ARGS.has(argName)) {
            return formatPathForDisplay(strValue);
        }

        // Commands: show single-line in full, truncate multi-line (heredocs) to first line
        if (argName === 'command') {
            const newlineIndex = strValue.indexOf('\n');
            if (newlineIndex === -1) {
                // Single-line command: show in full (useful for complex pipes)
                return strValue;
            }
            // Multi-line command (heredoc): show first line only
            return strValue.slice(0, newlineIndex) + '...';
        }

        // URLs: never truncate
        if (NEVER_TRUNCATE_ARGS.has(argName)) {
            return strValue;
        }

        // Other args: simple truncation
        return strValue.length > 40 ? strValue.slice(0, 37) + '...' : strValue;
    };

    if (config) {
        // Use tool-specific config
        for (const argName of config.argsToShow) {
            if (!(argName in args)) continue;
            if (parts.length >= 3) break;

            const formattedValue = formatArgValue(argName, args[argName]);

            if (argName === config.primaryArg) {
                // Primary arg without key name
                parts.unshift(formattedValue);
            } else {
                // Secondary args with key name
                parts.push(`${argName}: ${formattedValue}`);
            }
        }
    } else {
        // Fallback for unknown tools (MCP, etc.)
        for (const [key, value] of entries) {
            if (parts.length >= 3) break;

            const formattedValue = formatArgValue(key, value);

            if (FALLBACK_PRIMARY_ARGS.has(key) || PATH_ARGS.has(key)) {
                // Primary arg without key name
                parts.unshift(formattedValue);
            } else {
                // Other args with key name
                parts.push(`${key}: ${formattedValue}`);
            }
        }
    }

    return parts.join(', ');
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
