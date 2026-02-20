/**
 * Tool Display Types
 *
 * Discriminated union types for structured tool result rendering.
 * These types enable both CLI and WebUI to render tool results with
 * appropriate formatting (diffs, shell output, search results, etc.)
 *
 * Tools return `_display` field in their result, which is preserved
 * by the sanitizer in `SanitizedToolResult.meta.display`.
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
    | GenericDisplayData;

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

// =============================================================================
// Validation
// =============================================================================

/** Valid display type values */
const VALID_DISPLAY_TYPES = ['diff', 'shell', 'search', 'file', 'generic'] as const;

/**
 * Validates that an unknown value is a valid ToolDisplayData.
 * Used by sanitizer to safely extract _display from tool results.
 */
export function isValidDisplayData(d: unknown): d is ToolDisplayData {
    if (d === null || typeof d !== 'object') {
        return false;
    }
    const obj = d as Record<string, unknown>;
    return (
        typeof obj.type === 'string' &&
        (VALID_DISPLAY_TYPES as readonly string[]).includes(obj.type)
    );
}
