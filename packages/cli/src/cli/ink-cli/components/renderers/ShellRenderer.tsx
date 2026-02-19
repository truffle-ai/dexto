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
    // Prefer stdout; fall back to stderr if stdout is empty/undefined
    const output = data.stdout && data.stdout.length > 0 ? data.stdout : data.stderr || '';

    const outputLines = output.split('\n').filter((line) => line.length > 0);
    const displayLines = outputLines.slice(0, maxLines);
    const truncatedCount = outputLines.length - displayLines.length;

    return (
        <Box flexDirection="column">
            {data.isBackground && <Text color="gray">{'    '}(background)</Text>}

            {outputLines.length === 0 ? (
                <Text color="gray">{'    '}(No output)</Text>
            ) : (
                <>
                    {displayLines.map((line, i) => (
                        <Text key={i} color="gray" wrap="truncate">
                            {'    '}
                            {line}
                        </Text>
                    ))}
                    {truncatedCount > 0 && (
                        <Text color="gray">
                            {'    '}+{truncatedCount} lines
                        </Text>
                    )}
                </>
            )}

            {data.exitCode !== 0 && (
                <Text color="red">
                    {'    '}exit code: {data.exitCode}
                </Text>
            )}
        </Box>
    );
}
