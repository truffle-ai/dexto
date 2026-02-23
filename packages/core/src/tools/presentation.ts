import type { ToolPresentationSnapshotV1 } from './types.js';

export function createLocalToolCallHeader(options: {
    title: string;
    argsText?: string;
}): NonNullable<ToolPresentationSnapshotV1['header']> {
    return {
        title: options.title,
        ...(options.argsText ? { argsText: options.argsText } : {}),
    };
}

export function createLocalToolCallSnapshot(options: {
    title: string;
    argsText?: string;
}): ToolPresentationSnapshotV1 {
    return {
        version: 1,
        source: { type: 'local' },
        header: createLocalToolCallHeader(options),
    };
}

export function truncateForHeader(value: string, maxLen: number): string {
    if (value.length <= maxLen) return value;
    if (maxLen <= 3) return value.slice(0, maxLen);
    return value.slice(0, maxLen - 3) + '...';
}
