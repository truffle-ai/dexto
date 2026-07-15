import type { ToolPresentationSnapshotV1 } from './types.js';

export type { ToolDisplayData } from './display-types.js';
export { isValidDisplayData } from './display-types.js';
export type { ToolPresentationSnapshotV1 } from './presentation-schema.js';
export {
    isToolPresentationSnapshotV1,
    ToolPresentationSnapshotV1Schema,
} from './presentation-schema.js';

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
