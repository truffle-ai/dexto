/**
 * Write File Tool
 *
 * Internal tool for writing content to files (requires approval)
 */

import * as path from 'node:path';
import { z } from 'zod';
import { createPatch } from 'diff';
import { InternalTool, ToolExecutionContext, DextoRuntimeError, ApprovalType } from '@dexto/core';
import type {
    DiffDisplayData,
    FileDisplayData,
    ApprovalRequestDetails,
    ApprovalResponse,
} from '@dexto/core';
import { FileSystemErrorCode } from './error-codes.js';
import { BufferEncoding } from './types.js';
import type { FileToolOptions } from './file-tool-types.js';

const WriteFileInputSchema = z
    .object({
        file_path: z.string().describe('Absolute path where the file should be written'),
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

type WriteFileInput = z.input<typeof WriteFileInputSchema>;

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
export function createWriteFileTool(options: FileToolOptions): InternalTool {
    const { fileSystemService, directoryApproval } = options;

    // Store parent directory for use in onApprovalGranted callback
    let pendingApprovalParentDir: string | undefined;

    return {
        id: 'write_file',
        description:
            'Write content to a file. Creates a new file or overwrites existing file. Automatically creates backup of existing files before overwriting. Use create_dirs to create parent directories. Requires approval for all write operations. Returns success status, path, bytes written, and backup path if applicable.',
        inputSchema: WriteFileInputSchema,

        /**
         * Check if this write operation needs directory access approval.
         * Returns custom approval request if the file is outside allowed paths.
         */
        getApprovalOverride: (args: unknown): ApprovalRequestDetails | null => {
            const { file_path } = args as WriteFileInput;
            if (!file_path) return null;

            // Check if path is within config-allowed paths
            const isAllowed = fileSystemService.isPathWithinConfigAllowed(file_path);
            if (isAllowed) {
                return null; // Use normal tool confirmation
            }

            // Check if directory is already session-approved
            if (directoryApproval?.isSessionApproved(file_path)) {
                return null; // Already approved, use normal flow
            }

            // Need directory access approval
            const absolutePath = path.resolve(file_path);
            const parentDir = path.dirname(absolutePath);
            pendingApprovalParentDir = parentDir;

            return {
                type: ApprovalType.DIRECTORY_ACCESS,
                metadata: {
                    path: absolutePath,
                    parentDir,
                    operation: 'write',
                    toolName: 'write_file',
                },
            };
        },

        /**
         * Handle approved directory access - remember the directory for session
         */
        onApprovalGranted: (response: ApprovalResponse): void => {
            if (!directoryApproval || !pendingApprovalParentDir) return;

            // Check if user wants to remember the directory
            // Use type assertion to access rememberDirectory since response.data is a union type
            const data = response.data as { rememberDirectory?: boolean } | undefined;
            const rememberDirectory = data?.rememberDirectory ?? false;
            directoryApproval.addApproved(
                pendingApprovalParentDir,
                rememberDirectory ? 'session' : 'once'
            );

            // Clear pending state
            pendingApprovalParentDir = undefined;
        },

        /**
         * Generate preview for approval UI - shows diff or file creation info
         */
        generatePreview: async (input: unknown, _context?: ToolExecutionContext) => {
            const { file_path, content } = input as WriteFileInput;

            try {
                // Try to read existing file
                const originalFile = await fileSystemService.readFile(file_path);
                const originalContent = originalFile.content;

                // File exists - show diff preview
                return generateDiffPreview(file_path, originalContent, content);
            } catch (error) {
                // Only treat FILE_NOT_FOUND as "create new file", rethrow other errors
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === FileSystemErrorCode.FILE_NOT_FOUND
                ) {
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

        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { file_path, content, create_dirs, encoding } = input as WriteFileInput;

            // Check if file exists (for diff generation)
            let originalContent: string | null = null;
            try {
                const originalFile = await fileSystemService.readFile(file_path);
                originalContent = originalFile.content;
            } catch (error) {
                // Only treat FILE_NOT_FOUND as "create new file", rethrow other errors
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === FileSystemErrorCode.FILE_NOT_FOUND
                ) {
                    // File doesn't exist - this is a create operation
                    originalContent = null;
                } else {
                    // Permission denied, I/O errors, etc. - rethrow
                    throw error;
                }
            }

            // Write file using FileSystemService
            // Backup behavior is controlled by config.enableBackups (default: false)
            const result = await fileSystemService.writeFile(file_path, content, {
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
    };
}
