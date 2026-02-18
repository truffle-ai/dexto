/**
 * FileRenderer Component
 *
 * Renders file operation status.
 * - Read: "Read N lines"
 * - Write/Create: "Wrote N lines to filename"
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { FileDisplayData } from '@dexto/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';
import { formatLineNum, getLineNumWidth } from './diff-shared.js';

interface FileRendererProps {
    /** File display data from tool result */
    data: FileDisplayData;
    /** Maximum lines of content to display (default: 20) */
    maxLines?: number;
}

/**
 * Renders file operation status.
 * Uses ⎿ character for continuation lines.
 */
export function FileRenderer({ data, maxLines = 20 }: FileRendererProps) {
    const { operation, lineCount, path, content } = data;
    const relativePath = makeRelativePath(path);

    // Format based on operation type
    if (operation === 'read') {
        // Format: "Read N lines"
        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'file';
        return (
            <Text color="gray">
                {'  ⎿ '}Read {lineText} from {relativePath}
            </Text>
        );
    }

    // For write/create operations
    if (operation === 'write' || operation === 'create') {
        const verb = operation === 'create' ? 'Created' : 'Wrote';

        if (operation === 'create' && content) {
            const lines = content.split('\n');
            const displayLines = lines.slice(0, maxLines);
            const truncatedCount = lines.length - displayLines.length;
            const lineNumWidth = getLineNumWidth(lines.length);

            return (
                <Box flexDirection="column">
                    <Box>
                        <Text color="gray">{'  ⎿ '}</Text>
                        <Text>{relativePath}</Text>
                        <Text color="green"> (created)</Text>
                    </Box>
                    <Box flexDirection="column" paddingLeft={2}>
                        {displayLines.map((line, index) => (
                            <Box key={index}>
                                <Text color="gray">{formatLineNum(index + 1, lineNumWidth)}</Text>
                                <Text wrap="wrap">
                                    {'   '}
                                    {line}
                                </Text>
                            </Box>
                        ))}
                        {truncatedCount > 0 && (
                            <Text color="gray">... +{truncatedCount} lines</Text>
                        )}
                    </Box>
                </Box>
            );
        }

        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'content';
        return (
            <Text color="gray">
                {'  ⎿ '}
                {verb} {lineText} to {relativePath}
            </Text>
        );
    }

    // Delete operation
    if (operation === 'delete') {
        return (
            <Text color="gray">
                {'  ⎿ '}Deleted {relativePath}
            </Text>
        );
    }

    // Fallback
    return (
        <Text color="gray">
            {'  ⎿ '}
            {operation}
        </Text>
    );
}
