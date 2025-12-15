/**
 * FileRenderer Component
 *
 * Renders file operation status like Claude Code.
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
 * Uses ⎿ character for continuation lines like Claude Code.
 */
export function FileRenderer({ data }: FileRendererProps) {
    const { operation, lineCount } = data;

    // Format based on operation type
    if (operation === 'read') {
        // Claude Code style: "Read N lines"
        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'file';
        return (
            <Text dimColor>
                {'  ⎿ '}Read {lineText}
            </Text>
        );
    }

    // For write/create operations
    if (operation === 'write' || operation === 'create') {
        const lineText = lineCount !== undefined ? `${lineCount} lines` : 'content';
        return (
            <Text dimColor>
                {'  ⎿ '}Wrote {lineText}
            </Text>
        );
    }

    // Delete operation
    if (operation === 'delete') {
        return <Text dimColor>{'  ⎿ '}Deleted file</Text>;
    }

    // Fallback
    return (
        <Text dimColor>
            {'  ⎿ '}
            {operation}
        </Text>
    );
}
