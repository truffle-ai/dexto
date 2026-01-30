/**
 * FileSystem Service Types
 *
 * Types and interfaces for file system operations including reading, writing,
 * searching, and validation.
 */

// BufferEncoding type from Node.js
export type BufferEncoding =
    | 'ascii'
    | 'utf8'
    | 'utf-8'
    | 'utf16le'
    | 'ucs2'
    | 'ucs-2'
    | 'base64'
    | 'base64url'
    | 'latin1'
    | 'binary'
    | 'hex';

/**
 * File content with metadata
 */
export interface FileContent {
    content: string;
    lines: number;
    encoding: string;
    mimeType?: string;
    truncated: boolean;
    size: number;
}

/**
 * Options for reading files
 */
export interface ReadFileOptions {
    /** Maximum number of lines to read */
    limit?: number | undefined;
    /** Starting line number (1-based) */
    offset?: number | undefined;
    /** File encoding (default: utf-8) */
    encoding?: BufferEncoding | undefined;
}

/**
 * File metadata for glob results
 */
export interface FileMetadata {
    path: string;
    size: number;
    modified: Date;
    isDirectory: boolean;
}

/**
 * Options for glob operations
 */
export interface GlobOptions {
    /** Base directory to search from */
    cwd?: string | undefined;
    /** Maximum number of results */
    maxResults?: number | undefined;
    /** Include file metadata */
    includeMetadata?: boolean | undefined;
}

/**
 * Glob result
 */
export interface GlobResult {
    files: FileMetadata[];
    truncated: boolean;
    totalFound: number;
}

/**
 * Search match with context
 */
export interface SearchMatch {
    file: string;
    lineNumber: number;
    line: string;
    context?: {
        before: string[];
        after: string[];
    };
}

/**
 * Options for content search (grep)
 */
export interface GrepOptions {
    /** Base directory to search */
    path?: string | undefined;
    /** Glob pattern to filter files */
    glob?: string | undefined;
    /** Number of context lines before/after match */
    contextLines?: number | undefined;
    /** Case-insensitive search */
    caseInsensitive?: boolean | undefined;
    /** Maximum number of results */
    maxResults?: number | undefined;
    /** Include line numbers */
    lineNumbers?: boolean | undefined;
}

/**
 * Search result
 */
export interface SearchResult {
    matches: SearchMatch[];
    totalMatches: number;
    truncated: boolean;
    filesSearched: number;
}

/**
 * Options for writing files
 */
export interface WriteFileOptions {
    /** Create parent directories if they don't exist */
    createDirs?: boolean | undefined;
    /** File encoding (default: utf-8) */
    encoding?: BufferEncoding | undefined;
    /** Create backup before overwriting */
    backup?: boolean | undefined;
}

/**
 * Write result
 */
export interface WriteResult {
    success: boolean;
    path: string;
    bytesWritten: number;
    backupPath?: string | undefined;
    /** Original content if file was overwritten (undefined for new files) */
    originalContent?: string | undefined;
}

/**
 * Edit operation
 */
export interface EditOperation {
    oldString: string;
    newString: string;
    replaceAll?: boolean | undefined;
}

/**
 * Options for editing files
 */
export interface EditFileOptions {
    /** Create backup before editing */
    backup?: boolean;
    /** File encoding */
    encoding?: BufferEncoding;
}

/**
 * Edit result
 */
export interface EditResult {
    success: boolean;
    path: string;
    changesCount: number;
    backupPath?: string | undefined;
    /** Original content before edit (for diff generation) */
    originalContent: string;
    /** New content after edit (for diff generation) */
    newContent: string;
}

/**
 * Path validation result
 */
export interface PathValidation {
    isValid: boolean;
    error?: string;
    normalizedPath?: string;
}

/**
 * File system configuration
 */
export interface FileSystemConfig {
    /** Allowed base paths */
    allowedPaths: string[];
    /** Blocked paths (relative to allowed paths) */
    blockedPaths: string[];
    /** Blocked file extensions */
    blockedExtensions: string[];
    /** Maximum file size in bytes */
    maxFileSize: number;
    /** Enable automatic backups */
    enableBackups: boolean;
    /** Backup directory absolute path (required when enableBackups is true - provided by CLI enrichment) */
    backupPath?: string | undefined;
    /** Backup retention period in days (default: 7) */
    backupRetentionDays: number;
    /** Working directory for glob/grep operations (defaults to process.cwd()) */
    workingDirectory?: string | undefined;
}
