/**
 * ShellRenderer Component
 *
 * Renders shell command output with command, exit code, and duration.
 * Used for bash_exec tool results.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ShellDisplayData, ContentPart } from '@dexto/core';

interface ShellRendererProps {
    /** Shell display data from tool result */
    data: ShellDisplayData;
    /** Content parts containing stdout/stderr */
    content: ContentPart[];
    /** Maximum lines to display before truncating */
    maxLines?: number;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
}

/**
 * Renders shell command result with status and output.
 * Uses ⎿ character for continuation lines like Claude Code.
 */
export function ShellRenderer({ data, content, maxLines = 15 }: ShellRendererProps) {
    const { command, exitCode, duration, isBackground } = data;

    // Extract output from content
    const output = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

    const lines = output.split('\n').filter((line) => line.length > 0);
    const displayLines = lines.slice(0, maxLines);
    const truncated = lines.length > maxLines;

    // Truncate long commands for display
    const displayCommand = command.length > 60 ? command.slice(0, 57) + '...' : command;

    return (
        <Box flexDirection="column">
            {/* Status line with exit code and duration */}
            <Box>
                <Text dimColor>{'  ⎿ '}</Text>
                <Text dimColor>$ {displayCommand} </Text>
                {exitCode === 0 ? (
                    <Text color="green">ok</Text>
                ) : (
                    <Text color="red">exit {exitCode}</Text>
                )}
                <Text dimColor> {formatDuration(duration)}</Text>
                {isBackground && <Text color="yellow"> (bg)</Text>}
            </Box>

            {/* Output lines */}
            {displayLines.length > 0 && (
                <Box flexDirection="column">
                    {displayLines.map((line, i) => (
                        <Text key={i} dimColor wrap="truncate">
                            {'    '}
                            {line}
                        </Text>
                    ))}
                    {truncated && (
                        <Text dimColor>
                            {'    '}... {lines.length - maxLines} more lines
                        </Text>
                    )}
                </Box>
            )}
        </Box>
    );
}
