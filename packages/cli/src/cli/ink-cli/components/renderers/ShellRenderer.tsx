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
 * Renders shell command result with output.
 * Uses ⎿ character for continuation lines like Claude Code.
 * Shows just the output, "(No content)" for empty results.
 */
export function ShellRenderer({ content, maxLines = 15 }: ShellRendererProps) {
    // Extract output from content
    const output = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

    const lines = output.split('\n').filter((line) => line.length > 0);
    const displayLines = lines.slice(0, maxLines);
    const truncated = lines.length > maxLines;

    // No output - show "(No content)" like Claude Code
    if (lines.length === 0) {
        return <Text dimColor>{'  ⎿ '}(No content)</Text>;
    }

    // Single line output - show inline
    if (lines.length === 1 && lines[0]) {
        return (
            <Text dimColor>
                {'  ⎿ '}
                {lines[0]}
            </Text>
        );
    }

    // Multi-line output
    return (
        <Box flexDirection="column">
            {displayLines.map((line, i) => (
                <Text key={i} dimColor wrap="truncate">
                    {i === 0 ? '  ⎿ ' : '    '}
                    {line}
                </Text>
            ))}
            {truncated && (
                <Text dimColor>
                    {'    '}... {lines.length - maxLines} more lines
                </Text>
            )}
        </Box>
    );
}
