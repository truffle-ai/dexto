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

    const lines = text.split('\n');
    const displayLines = lines.slice(0, maxLines);
    const truncated = lines.length > maxLines;

    return (
        <Box flexDirection="column">
            {displayLines.map((line, i) => (
                <Text key={i} color="gray" dimColor wrap="truncate">
                    {line}
                </Text>
            ))}
            {truncated && (
                <Text color="gray" dimColor>
                    ... ({lines.length - maxLines} more lines)
                </Text>
            )}
        </Box>
    );
}
