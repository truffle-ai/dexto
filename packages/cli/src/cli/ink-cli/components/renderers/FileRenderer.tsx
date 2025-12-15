/**
 * FileRenderer Component
 *
 * Renders file operation status (read, write, create, delete).
 * Used for read_file and write_file (create) operations.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { FileDisplayData } from '@dexto/core';

interface FileRendererProps {
    /** File display data from tool result */
    data: FileDisplayData;
}

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get color for operation type
 */
function getOperationColor(operation: FileDisplayData['operation']): string {
    switch (operation) {
        case 'read':
            return 'blue';
        case 'write':
            return 'yellow';
        case 'create':
            return 'green';
        case 'delete':
            return 'red';
        default:
            return 'white';
    }
}

/**
 * Renders file operation status.
 */
export function FileRenderer({ data }: FileRendererProps) {
    const { path, operation, size, backupPath } = data;
    const color = getOperationColor(operation);

    return (
        <Box>
            <Text color={color}>{operation}</Text>
            <Text color="gray" dimColor>
                {' '}
                {path}
            </Text>
            {size !== undefined && (
                <Text color="gray" dimColor>
                    {' '}
                    ({formatSize(size)})
                </Text>
            )}
            {backupPath && (
                <Text color="gray" dimColor>
                    {' '}
                    backup: {backupPath}
                </Text>
            )}
        </Box>
    );
}
