/**
 * Message formatting utilities
 * Helpers for creating and formatting messages
 */

import path from 'path';
import os from 'os';
import type {
    DextoAgent,
    InternalMessage,
    ContentPart,
    ToolCall,
    ToolPresentationSnapshotV1,
} from '@dexto/core';
import { isTextPart, isAssistantMessage, isToolMessage } from '@dexto/core';
import type { Message } from '../state/types.js';

const HIDDEN_TOOL_NAMES = new Set(['wait_for']);

export function normalizeToolName(toolName: string): string {
    if (toolName.startsWith('mcp--')) {
        const trimmed = toolName.substring('mcp--'.length);
        const parts = trimmed.split('--');
        return parts.length >= 2 ? parts.slice(1).join('--') : trimmed;
    }
    return toolName;
}

export function shouldHideTool(toolName: string | undefined): boolean {
    if (!toolName) {
        return false;
    }

    return HIDDEN_TOOL_NAMES.has(normalizeToolName(toolName));
}

const backgroundCompletionRegex =
    /<background-task-completion>[\s\S]*?<\/background-task-completion>/g;
const stripBackgroundCompletion = (text: string): string =>
    text.replace(backgroundCompletionRegex, '').replace('<background-task-completion>', '').trim();

import { generateMessageId } from './idGenerator.js';

/**
 * Regex to detect skill invocation messages.
 * Matches: <skill-invocation>...skill: "config:skill-name"...</skill-invocation>
 * Works for both fork and inline skills.
 */
const SKILL_INVOCATION_REGEX =
    /<skill-invocation>[\s\S]*?skill:\s*"(?:config:)?([^"]+)"[\s\S]*?<\/skill-invocation>/;

/**
 * Formats a skill invocation message for clean display.
 * Converts verbose <skill-invocation> blocks to clean /skill-name format.
 * Works for both fork skills (just the tag) and inline skills (tag + content).
 *
 * @param content - The message content to check and format
 * @returns Formatted content if it's a skill invocation, original content otherwise
 */
export function formatSkillInvocationMessage(content: string): string {
    const match = content.match(SKILL_INVOCATION_REGEX);
    if (match) {
        const skillName = match[1];
        // Extract task context if present
        const contextMatch = content.match(/Task context:\s*(.+?)(?:\n|$)/);
        if (contextMatch) {
            return `/${skillName} ${contextMatch[1]}`;
        }
        return `/${skillName}`;
    }
    return content;
}

/**
 * Checks if a message content is a skill invocation.
 */
export function isSkillInvocationMessage(content: string): boolean {
    return SKILL_INVOCATION_REGEX.test(content);
}

/**
 * Convert absolute path to display-friendly relative path.
 * Strategy:
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
 * Strategy:
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
 * Gets a user-friendly display name for a tool.
 * Returns the friendly name if known, otherwise returns a title-cased version.
 * MCP tools keep their server prefix for clarity (e.g., "mcp--filesystem--read_file").
 */
function toTitleCase(name: string): string {
    return name
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export function getToolDisplayName(toolName: string): string {
    // MCP tools: strip `mcp--` prefix and server name for clean display
    if (toolName.startsWith('mcp--')) {
        const parts = toolName.split('--');
        if (parts.length >= 3) {
            return toTitleCase(parts.slice(2).join('--'));
        }
        return toTitleCase(toolName.substring(5));
    }
    return toTitleCase(toolName);
}

/**
 * Gets the tool type badge for display.
 * Returns: 'local' or MCP server name.
 */
export function getToolTypeBadge(toolName: string): string {
    // MCP tools with server name
    if (toolName.startsWith('mcp--')) {
        const parts = toolName.split('--');
        if (parts.length >= 3 && parts[1]) {
            return `MCP: ${parts[1]}`; // Format: 'MCP: github', 'MCP: postgres'
        }
        return 'MCP';
    }

    return 'local';
}

/**
 * Result of formatting a tool header for display
 */
export interface FormattedToolHeader {
    /** User-friendly display name (e.g., "Explore", "Read") */
    displayName: string;
    /** Formatted arguments string (e.g., "file.ts" or "pattern, path: /src") */
    argsFormatted: string;
    /** Tool type badge (e.g., "internal", "custom", "MCP: github") */
    badge: string;
    /** Full formatted header string (e.g., "Explore(task) [custom]") */
    header: string;
}

/**
 * Formats a tool call header for consistent display across CLI.
 * Used by both tool messages and approval prompts.
 *
 * Handles special cases like spawn_agent (uses agentId as display name).
 *
 * @param toolName - Tool name (local tool id or `mcp--...`)
 * @param args - Tool arguments object
 * @returns Formatted header components and full string
 */
export function formatToolHeader(options: {
    toolName: string;
    args: Record<string, unknown>;
    presentationSnapshot?: ToolPresentationSnapshotV1;
}): FormattedToolHeader {
    const { toolName, args, presentationSnapshot } = options;

    const snapshotHeader = presentationSnapshot?.header;
    const displayName = snapshotHeader?.title ?? getToolDisplayName(toolName);
    const argsFormatted = snapshotHeader?.argsText ?? formatArgsFallback(args);
    const badge = getToolTypeBadge(toolName);

    // Only show badge for MCP tools (external tools worth distinguishing)
    const isMcpTool = badge.startsWith('MCP');
    const badgeSuffix = isMcpTool ? ` [${badge}]` : '';

    // Format: DisplayName(args) [badge] (badge only for MCP)
    const header = argsFormatted
        ? `${displayName}(${argsFormatted})${badgeSuffix}`
        : `${displayName}()${badgeSuffix}`;

    return {
        displayName,
        argsFormatted,
        badge,
        header,
    };
}

/**
 * Simple fallback for formatting tool args when no snapshot is provided.
 * Used for MCP tools that don't implement tool header snapshots.
 */
function formatArgsFallback(args: Record<string, unknown>): string {
    const entries = Object.entries(args)
        .filter(([k]) => !['__meta', 'description'].includes(k))
        .slice(0, 4);

    const str = entries
        .map(([k, v]) => {
            const val = typeof v === 'string' ? v : JSON.stringify(v);
            return val.length > 50 ? `${k}=${val.slice(0, 47)}...` : `${k}=${val}`;
        })
        .join(', ');

    return str.length > 150 ? str.slice(0, 147) + '...' : str;
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
        content: `Error: ${content}`,
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
 * Generates a preview of tool result content for display
 */
export function formatToolResultPreview(result: string): string {
    try {
        const parsed = JSON.parse(result) as {
            status?: string;
            taskId?: string;
            count?: number;
            tasks?: Array<{ status?: string; taskId?: string }>;
            found?: boolean;
            result?: string;
        };

        if (parsed.status === 'running' && parsed.taskId) {
            return `Background task started (id: ${parsed.taskId})`;
        }

        if (parsed.found !== undefined && parsed.taskId) {
            return parsed.found
                ? `Task ${parsed.taskId} status: ${parsed.status ?? 'unknown'}`
                : `Task ${parsed.taskId} not found`;
        }

        if (Array.isArray(parsed.tasks) && typeof parsed.count === 'number') {
            const running = parsed.tasks.filter((task) => task.status === 'running').length;
            return `Tasks: ${parsed.count} total${running > 0 ? ` • ${running} running` : ''}`;
        }
    } catch {
        // fall through
    }

    const maxChars = 200;
    if (result.length <= maxChars) {
        return result;
    }
    return result.slice(0, maxChars) + '…';
}

function generateToolResultPreview(content: ContentPart[]): string {
    const textContent = extractTextContent(content);
    if (!textContent) return '';

    try {
        const parsed = JSON.parse(textContent) as {
            status?: string;
            taskId?: string;
            count?: number;
            tasks?: Array<{ status?: string; taskId?: string }>;
            found?: boolean;
        };

        if (parsed.status === 'running' && parsed.taskId) {
            return `Background task started (id: ${parsed.taskId})`;
        }

        if (Array.isArray(parsed.tasks) && typeof parsed.count === 'number') {
            const running = parsed.tasks.filter((task) => task.status === 'running').length;
            return `Tasks: ${parsed.count} total${running > 0 ? ` • ${running} running` : ''}`;
        }

        if (parsed.found !== undefined && parsed.taskId) {
            return parsed.found
                ? `Task ${parsed.taskId} status: ${parsed.status ?? 'unknown'}`
                : `Task ${parsed.taskId} not found`;
        }
    } catch {
        // Not JSON; fall through to raw text preview
    }

    const lines = textContent.split('\n');
    const previewLines = lines.slice(0, 5);
    let preview = previewLines.join('\n');

    // Truncate if too long
    if (preview.length > 400) {
        preview = preview.slice(0, 397) + '...';
    } else if (lines.length > 5) {
        preview += '\n...';
    }

    return preview;
}

/**
 * Converts session history messages to UI messages
 */
export function convertHistoryToUIMessages(
    history: InternalMessage[],
    sessionId: string
): Message[] {
    const uiMessages: Message[] = [];

    // Build a map of toolCallId -> ToolCall for looking up tool call args
    const toolCallMap = new Map<string, ToolCall>();
    for (const msg of history) {
        if (isAssistantMessage(msg) && msg.toolCalls) {
            for (const toolCall of msg.toolCalls) {
                toolCallMap.set(toolCall.id, toolCall);
            }
        }
    }

    history.forEach((msg, index) => {
        const timestamp = new Date(msg.timestamp ?? Date.now() - (history.length - index) * 1000);

        // Handle tool messages specially
        if (isToolMessage(msg)) {
            if (shouldHideTool(msg.name)) {
                return;
            }

            // Look up the original tool call to get args
            const toolCall = toolCallMap.get(msg.toolCallId);

            // Format tool name
            const displayName =
                msg.presentationSnapshot?.header?.title ?? getToolDisplayName(msg.name);

            // Format args if we have them
            let toolContent = displayName;
            const snapshotArgsText = msg.presentationSnapshot?.header?.argsText;
            if (typeof snapshotArgsText === 'string' && snapshotArgsText.length > 0) {
                toolContent = `${displayName}(${snapshotArgsText})`;
            }
            if (!snapshotArgsText && toolCall) {
                try {
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    const argsFormatted = formatArgsFallback(args);
                    if (argsFormatted) {
                        toolContent = `${displayName}(${argsFormatted})`;
                    }
                } catch {
                    // Ignore JSON parse errors
                }
            }

            // Add tool type badge (only for MCP tools)
            const badge = getToolTypeBadge(msg.name);
            if (badge.startsWith('MCP')) {
                toolContent = `${toolContent} [${badge}]`;
            }

            // Generate result preview
            const resultPreview = generateToolResultPreview(msg.content);

            uiMessages.push({
                id: `session-${sessionId}-${index}`,
                role: 'tool',
                content: toolContent,
                timestamp,
                toolStatus: 'finished',
                toolResult: resultPreview,
                isError: msg.success === false,
                // Store content parts for potential rich rendering
                toolContent: msg.content,
                // Restore structured display data for rich rendering (diffs, shell output, etc.)
                ...(msg.displayData !== undefined && {
                    toolDisplayData: msg.displayData,
                }),
            });
            return;
        }

        // Handle assistant messages - skip those with only tool calls (no text content)
        if (isAssistantMessage(msg)) {
            let textContent = extractTextContent(msg.content);
            textContent = stripBackgroundCompletion(textContent);

            // Skip if no text content (message was just tool calls)
            if (!textContent) return;

            uiMessages.push({
                id: `session-${sessionId}-${index}`,
                role: 'assistant',
                content: textContent,
                timestamp,
            });
            return;
        }

        // Handle other messages (user, system)
        let textContent = extractTextContent(msg.content);
        textContent = stripBackgroundCompletion(textContent);

        // Skip empty messages
        if (!textContent) return;

        // Format skill invocation messages for cleaner display
        if (msg.role === 'user') {
            textContent = formatSkillInvocationMessage(textContent);
        }

        uiMessages.push({
            id: `session-${sessionId}-${index}`,
            role: msg.role,
            content: textContent,
            timestamp,
        });
    });

    return uiMessages;
}

/**
 * Collects startup information for display in header
 */
export async function getStartupInfo(agent: DextoAgent, sessionId: string | null) {
    const connectedServers = agent.mcpManager.getClients();
    const failedConnections = agent.mcpManager.getFailedConnections();
    const tools = await agent.getAllTools();
    const toolCount = Object.keys(tools).length;
    // File logging is session-scoped. If a session already exists, show its log file.
    const logFile = sessionId
        ? ((await agent.getSession(sessionId))?.logger.getLogFilePath() ?? null)
        : null;

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
