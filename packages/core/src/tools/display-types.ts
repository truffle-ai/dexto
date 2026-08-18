/**
 * Tool Display Types
 *
 * Discriminated union types for structured tool result rendering.
 * These types enable both CLI and WebUI to render tool results with
 * appropriate formatting (diffs, shell output, search results, etc.)
 *
 * Legacy tools may return a `_display` field in their result. Tool presentation resolvers can
 * provide the same metadata without adding it to the model-visible result. Both paths end up in
 * `SanitizedToolResult.meta.display`.
 */

// =============================================================================
// Discriminated Union Types
// =============================================================================

/**
 * Discriminated union of all tool display data types.
 * Switch on `type` field for exhaustive handling.
 */
export type ToolDisplayData =
    | DiffDisplayData
    | ShellDisplayData
    | SearchDisplayData
    | FileDisplayData
    | GenericDisplayData
    | TextDisplayData
    | StatusDisplayData
    | RecordDisplayData
    | CollectionDisplayData
    | ProcessDisplayData;

/** Display data for a plain text result. */
export interface TextDisplayData {
    type: 'text';
    title: string | null;
    text: string;
}

/** Display data for a single operation status. */
export interface StatusDisplayData {
    type: 'status';
    title: string | null;
    status: 'success' | 'error' | 'info' | 'warning';
    message: string;
}

export interface ToolDisplayField {
    label: string;
    value: string;
}

/** Display data for one structured record. */
export interface RecordDisplayData {
    type: 'record';
    title: string | null;
    fields: ToolDisplayField[];
}

/** Display data for a list of values. */
export interface CollectionDisplayData {
    type: 'collection';
    title: string | null;
    items: string[];
}

/** Display data for a supervised process and its lifecycle state. */
export interface ProcessDisplayData {
    type: 'process';
    title: string | null;
    processId: string;
    command: string | null;
    state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
}

/**
 * Display data for file edit operations (edit_file, write_file overwrites).
 * Contains unified diff format for rendering changes.
 */
export interface DiffDisplayData {
    type: 'diff';
    /** Optional UI title for this display (e.g., "Update file") */
    title?: string;
    /** Unified diff string (output of `diff` package's createPatch) */
    unified: string;
    /** Path to the file that was modified */
    filename: string;
    /** Number of lines added */
    additions: number;
    /** Number of lines removed */
    deletions: number;
    /** Original file content (optional, for approval preview) */
    beforeContent?: string;
    /** New file content (optional, for approval preview) */
    afterContent?: string;
}

/**
 * Display data for shell command execution (bash_exec).
 * Contains command metadata and output for structured rendering.
 */
export interface ShellDisplayData {
    type: 'shell';
    /** Optional UI title for this display (e.g., "Bash") */
    title?: string;
    /** The command that was executed */
    command: string;
    /** Exit code from the command (0 = success) */
    exitCode: number;
    /** Execution duration in milliseconds */
    duration: number;
    /** Whether command is running in background */
    isBackground?: boolean;
    /** Standard output from the command */
    stdout?: string;
    /** Standard error from the command */
    stderr?: string;
}

/**
 * Display data for search operations (grep_content, glob_files).
 * Contains structured match results for formatted rendering.
 */
export interface SearchDisplayData {
    type: 'search';
    /** Optional UI title for this display */
    title?: string;
    /** The search pattern used */
    pattern: string;
    /** Array of match results */
    matches: SearchMatch[];
    /** Total number of matches found (may exceed displayed matches) */
    totalMatches: number;
    /** Whether results were truncated due to limits */
    truncated: boolean;
}

/**
 * Individual search match result.
 */
export interface SearchMatch {
    /** File path where match was found */
    file: string;
    /** Line number of the match (0 for glob results) */
    line: number;
    /** Content of the matching line or filename */
    content: string;
    /** Optional surrounding context lines */
    context?: string[];
}

/**
 * Display data for file operations (read_file, write_file create).
 * Contains file metadata for simple status rendering.
 */
export interface FileDisplayData {
    type: 'file';
    /** Optional UI title for this display (e.g., "Create file") */
    title?: string;
    /** Path to the file */
    path: string;
    /** Type of operation performed */
    operation: 'read' | 'write' | 'create' | 'delete';
    /** File size in bytes (optional) */
    size?: number;
    /** Number of lines read/written (optional) */
    lineCount?: number;
    /** Path to backup file if created (optional) */
    backupPath?: string;
    /** File content for create operations (used in approval preview) */
    content?: string;
}

/**
 * Fallback display data for unknown tools or MCP tools.
 * Renderers should fall back to rendering content[] directly.
 */
export interface GenericDisplayData {
    type: 'generic';
    /** Optional UI title for this display */
    title?: string;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for DiffDisplayData.
 */
export function isDiffDisplay(d: ToolDisplayData): d is DiffDisplayData {
    return d.type === 'diff';
}

/**
 * Type guard for ShellDisplayData.
 */
export function isShellDisplay(d: ToolDisplayData): d is ShellDisplayData {
    return d.type === 'shell';
}

/**
 * Type guard for SearchDisplayData.
 */
export function isSearchDisplay(d: ToolDisplayData): d is SearchDisplayData {
    return d.type === 'search';
}

/**
 * Type guard for FileDisplayData.
 */
export function isFileDisplay(d: ToolDisplayData): d is FileDisplayData {
    return d.type === 'file';
}

/**
 * Type guard for GenericDisplayData.
 */
export function isGenericDisplay(d: ToolDisplayData): d is GenericDisplayData {
    return d.type === 'generic';
}

/** Type guard for TextDisplayData. */
export function isTextDisplay(d: ToolDisplayData): d is TextDisplayData {
    return d.type === 'text';
}

/** Type guard for StatusDisplayData. */
export function isStatusDisplay(d: ToolDisplayData): d is StatusDisplayData {
    return d.type === 'status';
}

/** Type guard for RecordDisplayData. */
export function isRecordDisplay(d: ToolDisplayData): d is RecordDisplayData {
    return d.type === 'record';
}

/** Type guard for CollectionDisplayData. */
export function isCollectionDisplay(d: ToolDisplayData): d is CollectionDisplayData {
    return d.type === 'collection';
}

/** Type guard for ProcessDisplayData. */
export function isProcessDisplay(d: ToolDisplayData): d is ProcessDisplayData {
    return d.type === 'process';
}

// =============================================================================
// Validation
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
    return value === undefined || isNonNegativeInteger(value);
}

function isSearchMatch(value: unknown): value is SearchMatch {
    if (!isRecord(value)) {
        return false;
    }

    const context = value['context'];
    return (
        typeof value['file'] === 'string' &&
        isNonNegativeInteger(value['line']) &&
        typeof value['content'] === 'string' &&
        (context === undefined ||
            (Array.isArray(context) && context.every((line) => typeof line === 'string')))
    );
}

function isToolDisplayField(value: unknown): value is ToolDisplayField {
    return (
        isRecord(value) && typeof value['label'] === 'string' && typeof value['value'] === 'string'
    );
}

/**
 * Validates that an unknown value is a valid ToolDisplayData.
 * Used by sanitizer to safely extract _display from tool results.
 */
export function isValidDisplayData(d: unknown): d is ToolDisplayData {
    if (!isRecord(d)) {
        return false;
    }

    switch (d['type']) {
        case 'diff':
            return (
                typeof d['unified'] === 'string' &&
                typeof d['filename'] === 'string' &&
                isNonNegativeInteger(d['additions']) &&
                isNonNegativeInteger(d['deletions']) &&
                isOptionalString(d['title']) &&
                isOptionalString(d['beforeContent']) &&
                isOptionalString(d['afterContent'])
            );
        case 'shell':
            return (
                typeof d['command'] === 'string' &&
                typeof d['exitCode'] === 'number' &&
                Number.isFinite(d['exitCode']) &&
                typeof d['duration'] === 'number' &&
                Number.isFinite(d['duration']) &&
                isOptionalString(d['title']) &&
                (d['isBackground'] === undefined || typeof d['isBackground'] === 'boolean') &&
                isOptionalString(d['stdout']) &&
                isOptionalString(d['stderr'])
            );
        case 'search':
            return (
                typeof d['pattern'] === 'string' &&
                Array.isArray(d['matches']) &&
                d['matches'].every(isSearchMatch) &&
                isNonNegativeInteger(d['totalMatches']) &&
                typeof d['truncated'] === 'boolean' &&
                isOptionalString(d['title'])
            );
        case 'file':
            return (
                typeof d['path'] === 'string' &&
                (d['operation'] === 'read' ||
                    d['operation'] === 'write' ||
                    d['operation'] === 'create' ||
                    d['operation'] === 'delete') &&
                isOptionalString(d['title']) &&
                isOptionalNonNegativeInteger(d['size']) &&
                isOptionalNonNegativeInteger(d['lineCount']) &&
                isOptionalString(d['backupPath']) &&
                isOptionalString(d['content'])
            );
        case 'generic':
            return isOptionalString(d['title']);
        case 'text':
            return isNullableString(d['title']) && typeof d['text'] === 'string';
        case 'status':
            return (
                isNullableString(d['title']) &&
                (d['status'] === 'success' ||
                    d['status'] === 'error' ||
                    d['status'] === 'info' ||
                    d['status'] === 'warning') &&
                typeof d['message'] === 'string'
            );
        case 'record':
            return (
                isNullableString(d['title']) &&
                Array.isArray(d['fields']) &&
                d['fields'].every(isToolDisplayField)
            );
        case 'collection':
            return (
                isNullableString(d['title']) &&
                Array.isArray(d['items']) &&
                d['items'].every((item) => typeof item === 'string')
            );
        case 'process':
            return (
                isNullableString(d['title']) &&
                typeof d['processId'] === 'string' &&
                isNullableString(d['command']) &&
                (d['state'] === 'running' ||
                    d['state'] === 'succeeded' ||
                    d['state'] === 'failed' ||
                    d['state'] === 'stopped' ||
                    d['state'] === 'interrupted') &&
                (d['exitCode'] === null ||
                    (typeof d['exitCode'] === 'number' && Number.isInteger(d['exitCode']))) &&
                isNullableString(d['startedAt']) &&
                isNullableString(d['finishedAt'])
            );
        default:
            return false;
    }
}
