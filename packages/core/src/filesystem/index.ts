/**
 * FileSystem Module
 *
 * Exports file system service, types, errors, and utilities
 */

export { FileSystemService } from './filesystem-service.js';
export { PathValidator } from './path-validator.js';
export { FileSystemError } from './errors.js';
export { FileSystemErrorCode } from './error-codes.js';
export type {
    FileSystemConfig,
    FileContent,
    ReadFileOptions,
    GlobOptions,
    GlobResult,
    GrepOptions,
    SearchResult,
    SearchMatch,
    WriteFileOptions,
    WriteResult,
    EditFileOptions,
    EditResult,
    EditOperation,
    FileMetadata,
    PathValidation,
    BufferEncoding,
} from './types.js';
