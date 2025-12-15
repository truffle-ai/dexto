/**
 * DiffRenderer Component
 *
 * Renders unified diff output with colored +/- lines.
 * Used for edit_file and write_file (overwrite) operations.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DiffDisplayData } from '@dexto/core';

interface DiffRendererProps {
    /** Diff display data from tool result */
    data: DiffDisplayData;
    /** Maximum lines to display before truncating */
    maxLines?: number;
}

interface ParsedDiffLine {
    type: 'header' | 'addition' | 'deletion' | 'context';
    content: string;
}

/**
 * Parse unified diff string into typed lines
 */
function parseDiffLines(unified: string): ParsedDiffLine[] {
    return unified.split('\n').map((line) => {
        // File headers and hunk headers
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
            return { type: 'header', content: line };
        }
        // Additions
        if (line.startsWith('+')) {
            return { type: 'addition', content: line.slice(1) };
        }
        // Deletions
        if (line.startsWith('-')) {
            return { type: 'deletion', content: line.slice(1) };
        }
        // Context lines (may start with space)
        return { type: 'context', content: line.startsWith(' ') ? line.slice(1) : line };
    });
}

/**
 * Renders a single diff line with appropriate coloring
 */
function DiffLine({ line }: { line: ParsedDiffLine }) {
    switch (line.type) {
        case 'header':
            return (
                <Text color="cyan" dimColor>
                    {line.content}
                </Text>
            );
        case 'addition':
            return <Text color="green">+ {line.content}</Text>;
        case 'deletion':
            return <Text color="red">- {line.content}</Text>;
        case 'context':
        default:
            return (
                <Text color="gray" dimColor>
                    {'  '}
                    {line.content}
                </Text>
            );
    }
}

/**
 * Renders unified diff with colored additions/deletions.
 */
export function DiffRenderer({ data, maxLines = 30 }: DiffRendererProps) {
    const { unified, filename, additions, deletions } = data;
    const allLines = parseDiffLines(unified);

    // Filter out empty/noise lines for cleaner display
    const meaningfulLines = allLines.filter(
        (line) => line.type !== 'header' || line.content.startsWith('@@') // Keep hunk headers
    );

    const displayLines = meaningfulLines.slice(0, maxLines);
    const truncated = meaningfulLines.length > maxLines;

    return (
        <Box flexDirection="column">
            {/* Summary header */}
            <Box>
                <Text color="gray" dimColor>
                    {filename}
                </Text>
                <Text color="green"> +{additions}</Text>
                <Text color="red"> -{deletions}</Text>
            </Box>

            {/* Diff lines */}
            {displayLines.map((line, i) => (
                <DiffLine key={i} line={line} />
            ))}

            {truncated && (
                <Text color="gray" dimColor>
                    ... ({meaningfulLines.length - maxLines} more lines)
                </Text>
            )}
        </Box>
    );
}
