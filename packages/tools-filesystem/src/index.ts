/**
 * @dexto/tools-filesystem
 *
 * FileSystem tools factory for Dexto agents.
 * Provides file operation tools: read, write, edit, glob, grep.
 */

// Main factory export (image-compatible)
export { fileSystemToolsFactory } from './tool-factory.js';
export type { FileSystemServiceGetter } from './file-tool-types.js';
export { FileSystemToolsConfigSchema, type FileSystemToolsConfig } from './tool-factory-config.js';

// Service and utilities (for advanced use cases)
export { FileSystemService } from './filesystem-service.js';
export { PathValidator } from './path-validator.js';
export { FileSystemError } from './errors.js';
export { FileSystemErrorCode } from './error-codes.js';

// Types
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
    DirectoryEntry,
    ListDirectoryOptions,
    ListDirectoryResult,
    CreateDirectoryOptions,
    CreateDirectoryResult,
    DeletePathOptions,
    DeletePathResult,
    RenamePathResult,
    PathValidation,
    BufferEncoding,
} from './types.js';

// Tool implementations (for custom integrations)
export { createReadFileTool } from './read-file-tool.js';
export { createWriteFileTool } from './write-file-tool.js';
export { createEditFileTool } from './edit-file-tool.js';
export { createGlobFilesTool } from './glob-files-tool.js';
export { createGrepContentTool } from './grep-content-tool.js';
