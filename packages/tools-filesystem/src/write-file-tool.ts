/**
 * Write File Tool
 *
 * Internal tool for writing content to files (requires approval)
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPatch } from 'diff';
import { DextoRuntimeError, ToolError, defineTool } from '@dexto/core';
import type { DiffDisplayData, FileDisplayData } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { FileSystemErrorCode } from './error-codes.js';
import { BufferEncoding } from './types.js';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';

/**
 * Cache for content hashes between preview and execute phases.
 * Keyed by toolCallId to ensure proper cleanup after execution.
 * This prevents file corruption when user modifies file between preview and execute.
 *
 * For new files (file doesn't exist at preview time), we store a special marker
 * to detect if the file was created between preview and execute.
 */
const previewContentHashCache = new Map<string, string | null>();

/** Marker for files that didn't exist at preview time */
const FILE_NOT_EXISTS_MARKER = null;

/**
 * Compute SHA-256 hash of content for change detection
 */
function computeContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

const WriteFileInputSchema = z
    .object({
        file_path: z.string().min(1).describe('Absolute path where the file should be written'),
        content: z.string().describe('Content to write to the file'),
        create_dirs: z
            .boolean()
            .optional()
            .default(false)
            .describe("Create parent directories if they don't exist (default: false)"),
        encoding: z
            .enum(['utf-8', 'ascii', 'latin1', 'utf16le'])
            .optional()
            .default('utf-8')
            .describe('File encoding (default: utf-8)'),
    })
    .strict();

/**
 * Generate diff preview without modifying the file
 */
function generateDiffPreview(
    filePath: string,
    originalContent: string,
    newContent: string
): DiffDisplayData {
    const unified = createPatch(filePath, originalContent, newContent, 'before', 'after', {
        context: 3,
    });
    const additions = (unified.match(/^\+[^+]/gm) || []).length;
    const deletions = (unified.match(/^-[^-]/gm) || []).length;

    return {
        type: 'diff',
        unified,
        filename: filePath,
        additions,
        deletions,
    };
}

/**
 * Create the write_file internal tool with directory approval support
 */
export function createWriteFileTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof WriteFileInputSchema> {
    return defineTool({
        id: 'write_file',
        displayName: 'Write',
        aliases: ['write'],
        description:
            'Write content to a file. Creates a new file or overwrites existing file. Automatically creates backup of existing files before overwriting. Use create_dirs to create parent directories. Requires approval for all write operations. Returns success status, path, bytes written, and backup path if applicable.',
        inputSchema: WriteFileInputSchema,

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'write_file',
            operation: 'write',
            getFileSystemService,
            resolvePaths: (input, fileSystemService) => {
                const baseDir = fileSystemService.getWorkingDirectory();
                const absolutePath = path.isAbsolute(input.file_path)
                    ? path.resolve(input.file_path)
                    : path.resolve(baseDir, input.file_path);
                return { path: absolutePath, parentDir: path.dirname(absolutePath) };
            },
        }),

        /**
         * Generate preview for approval UI - shows diff or file creation info
         * Stores content hash for change detection in execute phase.
         */
        async generatePreview(input, context: ToolExecutionContext) {
            const { file_path, content } = input;

            const resolvedFileSystemService = await getFileSystemService(context);

            try {
                // Try to read existing file
                const originalFile = await resolvedFileSystemService.readFile(file_path);
                const originalContent = originalFile.content;

                // Store content hash for change detection in execute phase
                if (context.toolCallId) {
                    previewContentHashCache.set(
                        context.toolCallId,
                        computeContentHash(originalContent)
                    );
                }

                // File exists - show diff preview
                return generateDiffPreview(file_path, originalContent, content);
            } catch (error) {
                // Only treat FILE_NOT_FOUND as "create new file", rethrow other errors
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === FileSystemErrorCode.FILE_NOT_FOUND
                ) {
                    // Store marker that file didn't exist at preview time
                    if (context.toolCallId) {
                        previewContentHashCache.set(context.toolCallId, FILE_NOT_EXISTS_MARKER);
                    }

                    // File doesn't exist - show as file creation with full content
                    const lineCount = content.split('\n').length;
                    const preview: FileDisplayData = {
                        type: 'file',
                        path: file_path,
                        operation: 'create',
                        size: content.length,
                        lineCount,
                        content, // Include content for approval preview
                    };
                    return preview;
                }
                // Permission denied, I/O errors, etc. - rethrow
                throw error;
            }
        },

        async execute(input, context: ToolExecutionContext) {
            const resolvedFileSystemService = await getFileSystemService(context);

            // Input is validated by provider before reaching here
            const { file_path, content, create_dirs, encoding } = input;

            // Check if file was modified since preview (safety check)
            // This prevents corrupting user edits made between preview approval and execution
            let originalContent: string | null = null;
            let fileExistsNow = false;

            try {
                const originalFile = await resolvedFileSystemService.readFile(file_path);
                originalContent = originalFile.content;
                fileExistsNow = true;
            } catch (error) {
                // Only treat FILE_NOT_FOUND as "create new file", rethrow other errors
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === FileSystemErrorCode.FILE_NOT_FOUND
                ) {
                    // File doesn't exist - this is a create operation
                    originalContent = null;
                    fileExistsNow = false;
                } else {
                    // Permission denied, I/O errors, etc. - rethrow
                    throw error;
                }
            }

            // Verify file hasn't changed since preview
            if (context.toolCallId && previewContentHashCache.has(context.toolCallId)) {
                const expectedHash = previewContentHashCache.get(context.toolCallId);
                previewContentHashCache.delete(context.toolCallId); // Clean up regardless of outcome

                if (expectedHash === FILE_NOT_EXISTS_MARKER) {
                    // File didn't exist at preview time - verify it still doesn't exist
                    if (fileExistsNow) {
                        throw ToolError.fileModifiedSincePreview('write_file', file_path);
                    }
                } else if (expectedHash !== null) {
                    // File existed at preview time - verify content hasn't changed
                    if (!fileExistsNow) {
                        // File was deleted between preview and execute
                        throw ToolError.fileModifiedSincePreview('write_file', file_path);
                    }
                    if (originalContent === null) {
                        throw ToolError.executionFailed(
                            'write_file',
                            'Expected original file content when fileExistsNow is true'
                        );
                    }
                    const currentHash = computeContentHash(originalContent);
                    if (expectedHash !== currentHash) {
                        throw ToolError.fileModifiedSincePreview('write_file', file_path);
                    }
                }
            }

            // Write file using FileSystemService
            // Backup behavior is controlled by config.enableBackups (default: false)
            const result = await resolvedFileSystemService.writeFile(file_path, content, {
                createDirs: create_dirs,
                encoding: encoding as BufferEncoding,
            });

            // Build display data based on operation type
            let _display: DiffDisplayData | FileDisplayData;

            if (originalContent === null) {
                // New file creation
                const lineCount = content.split('\n').length;
                _display = {
                    type: 'file',
                    path: file_path,
                    operation: 'create',
                    size: result.bytesWritten,
                    lineCount,
                };
            } else {
                // File overwrite - generate diff using shared helper
                _display = generateDiffPreview(file_path, originalContent, content);
            }

            return {
                success: result.success,
                path: result.path,
                bytes_written: result.bytesWritten,
                ...(result.backupPath && { backup_path: result.backupPath }),
                _display,
            };
        },
    });
}
