import * as fs from 'node:fs/promises';
import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';

const LOG_LEVEL_VALUES = ['debug', 'info', 'warn', 'error', 'silly'] as const;
type LogLevel = (typeof LOG_LEVEL_VALUES)[number];

const ViewLogsInputSchema = z
    .object({
        lines: z
            .number()
            .int()
            .positive()
            .optional()
            .default(200)
            .describe('Number of log lines to return from the end of the log file'),
        query: z
            .string()
            .optional()
            .describe('Optional: filter logs by substring match (case-insensitive)'),
        level: z
            .union([z.enum(LOG_LEVEL_VALUES), z.array(z.enum(LOG_LEVEL_VALUES))])
            .optional()
            .describe('Optional: filter logs by level'),
        component: z.string().optional().describe('Optional: filter logs by component'),
        includeContext: z
            .boolean()
            .optional()
            .default(false)
            .describe('Whether to include structured context for JSON log entries'),
    })
    .strict();

type ViewLogsInput = z.input<typeof ViewLogsInputSchema>;

type ParsedLogEntry = {
    level: LogLevel;
    message: string;
    timestamp: string;
    component: string;
    agentId?: string | undefined;
    sessionId?: string | undefined;
    toolCallId?: string | undefined;
    context?: Record<string, unknown> | undefined;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseLogEntry(line: string): ParsedLogEntry | null {
    try {
        const parsed = JSON.parse(line) as unknown;
        if (!isPlainObject(parsed)) {
            return null;
        }

        const level = parsed.level;
        const message = parsed.message;
        const timestamp = parsed.timestamp;
        const component = parsed.component;

        if (
            typeof level !== 'string' ||
            !LOG_LEVEL_VALUES.includes(level as LogLevel) ||
            typeof message !== 'string' ||
            typeof timestamp !== 'string' ||
            typeof component !== 'string'
        ) {
            return null;
        }

        const agentId = parsed.agentId;
        const sessionId = parsed.sessionId;
        const toolCallId = parsed.toolCallId;
        const context = parsed.context;

        return {
            level: level as LogLevel,
            message,
            timestamp,
            component,
            ...(typeof agentId === 'string' && { agentId }),
            ...(typeof sessionId === 'string' && { sessionId }),
            ...(typeof toolCallId === 'string' && { toolCallId }),
            ...(isPlainObject(context) && { context }),
        };
    } catch {
        return null;
    }
}

async function readTailBytes(filePath: string, maxBytes: number): Promise<string> {
    const handle = await fs.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        const start = Math.max(0, stat.size - maxBytes);
        const length = stat.size - start;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
}

export function createViewLogsTool(options: { maxLogLines: number; maxLogBytes: number }): Tool {
    return {
        id: 'view_logs',
        description:
            'View this session log file (tail). Returns the most recent log lines for debugging. If file logging is not configured, returns a message instead.',
        inputSchema: ViewLogsInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const parsed = input as ViewLogsInput;

            const logFilePath = context.logger.getLogFilePath();
            if (!logFilePath) {
                return {
                    logFilePath: null,
                    lines: 0,
                    content: '',
                    message: 'No log file is configured for this session.',
                };
            }

            const requestedLines = parsed.lines ?? 200;
            const maxLines = options.maxLogLines;
            const linesToReturn = Math.min(requestedLines, maxLines);

            const query = parsed.query?.trim();
            const queryLower = query ? query.toLowerCase() : null;
            const component = parsed.component?.trim();
            const levelsInput = parsed.level;
            const levels =
                typeof levelsInput === 'string'
                    ? new Set<LogLevel>([levelsInput as LogLevel])
                    : Array.isArray(levelsInput)
                      ? new Set<LogLevel>(levelsInput as LogLevel[])
                      : null;

            let tailContent: string;
            try {
                tailContent = await readTailBytes(logFilePath, options.maxLogBytes);
            } catch (error) {
                throw ToolError.executionFailed(
                    'view_logs',
                    `Failed to read log file: ${error instanceof Error ? error.message : String(error)}`,
                    context.sessionId
                );
            }

            const allLines = tailContent
                .split(/\r?\n/)
                .map((l) => l.trimEnd())
                .filter((l) => l.trim().length > 0);

            const candidates = allLines.map((line) => ({
                raw: line,
                entry: tryParseLogEntry(line),
            }));

            const filtered = candidates.filter(({ raw, entry }) => {
                if (entry) {
                    if (levels && !levels.has(entry.level)) {
                        return false;
                    }

                    if (component && entry.component !== component) {
                        return false;
                    }

                    if (!queryLower) {
                        return true;
                    }

                    const contextText = entry.context ? JSON.stringify(entry.context) : '';
                    return (
                        entry.message.toLowerCase().includes(queryLower) ||
                        contextText.toLowerCase().includes(queryLower)
                    );
                }

                if (levels || component) {
                    return false;
                }

                if (!queryLower) {
                    return true;
                }

                return raw.toLowerCase().includes(queryLower);
            });

            const limited = filtered.slice(Math.max(0, filtered.length - linesToReturn));
            const outputLines = limited.map((l) => l.raw);
            const entries = limited
                .map(({ entry }) => entry)
                .filter((entry): entry is ParsedLogEntry => entry !== null)
                .map((entry) =>
                    parsed.includeContext
                        ? entry
                        : {
                              level: entry.level,
                              message: entry.message,
                              timestamp: entry.timestamp,
                              component: entry.component,
                              ...(entry.agentId !== undefined && { agentId: entry.agentId }),
                              ...(entry.sessionId !== undefined && { sessionId: entry.sessionId }),
                              ...(entry.toolCallId !== undefined && {
                                  toolCallId: entry.toolCallId,
                              }),
                          }
                );

            return {
                logFilePath,
                lines: outputLines.length,
                content: outputLines.join('\n'),
                ...(entries.length > 0 && { entries }),
                ...(query !== undefined && query.length > 0 && { query }),
                ...(levelsInput !== undefined && { level: levelsInput }),
                ...(component !== undefined && component.length > 0 && { component }),
            };
        },
    };
}
