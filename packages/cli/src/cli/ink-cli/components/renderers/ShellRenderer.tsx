/**
 * ShellRenderer Component
 *
 * Renders shell command output.
 * Shows actual stdout/stderr, limited to 5 lines with "+N lines" truncation.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ShellDisplayData } from '@dexto/core';

interface ShellRendererProps {
    /** Shell display data from tool result */
    data: ShellDisplayData;
    /** Maximum lines to display before truncating (default: 10) */
    maxLines?: number;
}

/**
 * Renders shell command result with output.
 * Uses ⎿ character for continuation lines.
 * Shows just the output, "(No content)" for empty results.
 */
export function ShellRenderer({ data, maxLines = 5 }: ShellRendererProps) {
    // Use stdout from display data, fall back to stderr if no stdout
    const output = data.stdout || data.stderr || '';

    const lines = output.split('\n').filter((line) => line.length > 0);
    const displayLines = lines.slice(0, maxLines);
    const truncatedCount = lines.length - maxLines;

    // No output - show "(No content)"
    if (lines.length === 0) {
        return <Text color="gray">{'  ⎿ '}(No content)</Text>;
    }

    // Single line output - show inline
    if (lines.length === 1 && lines[0]) {
        return (
            <Text color="gray">
                {'  ⎿ '}
                {lines[0]}
            </Text>
        );
    }

    // Multi-line output
    // TODO: Add ctrl+o expansion to show full output
    return (
        <Box flexDirection="column">
            {displayLines.map((line, i) => (
                <Text key={i} color="gray" wrap="truncate">
                    {i === 0 ? '  ⎿ ' : '    '}
                    {line}
                </Text>
            ))}
            {truncatedCount > 0 && (
                <Text color="gray">
                    {'    '}+{truncatedCount} lines
                </Text>
            )}
        </Box>
    );
}
