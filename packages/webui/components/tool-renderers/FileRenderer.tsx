/**
 * FileRenderer Component
 *
 * Renders file operation metadata (read, write, create, delete).
 * Compact single-line format with operation badge.
 */

import { FileText, FilePlus, FileX, FileEdit } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileDisplayData } from '@dexto/core';

interface FileRendererProps {
    /** File display data from tool result */
    data: FileDisplayData;
}

/**
 * Get operation icon and color based on operation type.
 */
function getOperationInfo(operation: FileDisplayData['operation']) {
    switch (operation) {
        case 'read':
            return {
                icon: FileText,
                label: 'Read',
                color: 'text-blue-600 dark:text-blue-400',
                bgColor: 'bg-blue-100 dark:bg-blue-900/30',
            };
        case 'write':
            return {
                icon: FileEdit,
                label: 'Updated',
                color: 'text-amber-600 dark:text-amber-400',
                bgColor: 'bg-amber-100 dark:bg-amber-900/30',
            };
        case 'create':
            return {
                icon: FilePlus,
                label: 'Created',
                color: 'text-green-600 dark:text-green-400',
                bgColor: 'bg-green-100 dark:bg-green-900/30',
            };
        case 'delete':
            return {
                icon: FileX,
                label: 'Deleted',
                color: 'text-red-600 dark:text-red-400',
                bgColor: 'bg-red-100 dark:bg-red-900/30',
            };
    }
}

/**
 * Format file size in human-readable format.
 */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extract relative path (last 2-3 segments) from full path.
 */
function getRelativePath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-3).join('/')}`;
}

/**
 * Renders file operation summary as a compact single-line card.
 */
export function FileRenderer({ data }: FileRendererProps) {
    const { path, operation, size, lineCount } = data;
    const opInfo = getOperationInfo(operation);
    const Icon = opInfo.icon;

    const metadata: string[] = [];
    if (lineCount !== undefined) {
        metadata.push(`${lineCount} line${lineCount !== 1 ? 's' : ''}`);
    }
    if (size !== undefined) {
        metadata.push(formatSize(size));
    }

    return (
        <div className="flex items-center gap-2 py-1">
            {/* Operation badge */}
            <div
                className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                    opInfo.bgColor,
                    opInfo.color
                )}
            >
                <Icon className="h-3 w-3" />
                <span>{opInfo.label}</span>
            </div>

            {/* File path */}
            <span className="font-mono text-xs text-foreground/80 truncate" title={path}>
                {getRelativePath(path)}
            </span>

            {/* Metadata */}
            {metadata.length > 0 && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    ({metadata.join(', ')})
                </span>
            )}
        </div>
    );
}
