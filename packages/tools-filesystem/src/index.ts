/**
 * @dexto/tools-filesystem
 *
 * FileSystem tools provider for Dexto agents.
 * Provides file operation tools: read, write, edit, glob, grep.
 */

// Main provider export
export { fileSystemToolsProvider } from './tool-provider.js';
export { fileSystemToolsFactory } from './tool-factory.js';
export type { FileToolOptions, DirectoryApprovalCallbacks } from './file-tool-types.js';

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
    PathValidation,
    BufferEncoding,
} from './types.js';

// Tool implementations (for custom integrations)
export { createReadFileTool } from './read-file-tool.js';
export { createWriteFileTool } from './write-file-tool.js';
export { createEditFileTool } from './edit-file-tool.js';
export { createGlobFilesTool } from './glob-files-tool.js';
export { createGrepContentTool } from './grep-content-tool.js';
