/**
 * FileRenderer Component
 *
 * Renders file operation status.
 * - Read: "Read N lines"
 * - Write/Create: "Wrote N lines to filename"
 */

import React from 'react';
import { Text } from 'ink';
import type { FileDisplayData } from '@dexto/core';

interface FileRendererProps {
    /** File display data from tool result */
    data: FileDisplayData;
}

/**
 * Renders file operation status.
 * Uses ⎿ character for continuation lines.
 */
export function FileRenderer({ data }: FileRendererProps) {
    const { operation, lineCount } = data;

    // Format based on operation type
    if (operation === 'read') {
        // Format: "Read N lines"
        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'file';
        return (
            <Text color="gray">
                {'  ⎿ '}Read {lineText}
            </Text>
        );
    }

    // For write/create operations
    if (operation === 'write' || operation === 'create') {
        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'content';
        return (
            <Text color="gray">
                {'  ⎿ '}Wrote {lineText}
            </Text>
        );
    }

    // Delete operation
    if (operation === 'delete') {
        return <Text color="gray">{'  ⎿ '}Deleted file</Text>;
    }

    // Fallback
    return (
        <Text color="gray">
            {'  ⎿ '}
            {operation}
        </Text>
    );
}
