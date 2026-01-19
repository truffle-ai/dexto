/**
 * GenericRenderer Component
 *
 * Fallback renderer for unknown tools and MCP tools.
 * Renders content[] as plain text with truncation.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ContentPart } from '@dexto/core';

interface GenericRendererProps {
    /** Content parts from SanitizedToolResult */
    content: ContentPart[];
    /** Maximum lines to display before truncating */
    maxLines?: number;
}

/**
 * Renders tool result content as plain text.
 * Used as fallback for tools without specific display data.
 * Uses ⎿ character for continuation lines.
 */
export function GenericRenderer({ content, maxLines = 15 }: GenericRendererProps) {
    // Extract text from content parts
    const text = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

    if (!text) {
        return null;
    }

    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    const displayLines = lines.slice(0, maxLines);
    const truncated = lines.length > maxLines;

    // For single line results, show inline
    if (lines.length === 1 && lines[0]) {
        const line = lines[0];
        return (
            <Text color="gray">
                {'  ⎿ '}
                {line.slice(0, 80)}
                {line.length > 80 ? '...' : ''}
            </Text>
        );
    }

    return (
        <Box flexDirection="column">
            <Text color="gray">
                {'  ⎿ '}
                {displayLines.length} lines
            </Text>
            {displayLines.map((line, i) => (
                <Text key={i} color="gray" wrap="truncate">
                    {'  ⎿ '}
                    {line}
                </Text>
            ))}
            {truncated && (
                <Text color="gray">
                    {'  ⎿ '}... {lines.length - maxLines} more lines
                </Text>
            )}
        </Box>
    );
}
