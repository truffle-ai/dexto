/**
 * Edit File Tool
 *
 * Internal tool for editing files by replacing text (requires approval)
 */

import * as path from 'node:path';
import { z } from 'zod';
import { createPatch } from 'diff';
import { InternalTool, ToolExecutionContext, ApprovalType } from '@dexto/core';
import type { DiffDisplayData, ApprovalRequestDetails, ApprovalResponse } from '@dexto/core';
import { ToolError } from '@dexto/core';
import { ToolErrorCode } from '@dexto/core';
import { DextoRuntimeError } from '@dexto/core';
import type { FileToolOptions } from './file-tool-types.js';

const EditFileInputSchema = z
    .object({
        file_path: z.string().describe('Absolute path to the file to edit'),
        old_string: z
            .string()
            .describe('Text to replace (must be unique unless replace_all is true)'),
        new_string: z.string().describe('Replacement text'),
        replace_all: z
            .boolean()
            .optional()
            .default(false)
            .describe('Replace all occurrences (default: false, requires unique match)'),
    })
    .strict();

type EditFileInput = z.input<typeof EditFileInputSchema>;

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
 * Create the edit_file internal tool with directory approval support
 */
export function createEditFileTool(options: FileToolOptions): InternalTool {
    const { fileSystemService, directoryApproval } = options;

    // Store parent directory for use in onApprovalGranted callback
    let pendingApprovalParentDir: string | undefined;

    return {
        id: 'edit_file',
        description:
            'Edit a file by replacing text. By default, old_string must be unique in the file (will error if found multiple times). Set replace_all=true to replace all occurrences. Automatically creates backup before editing. Requires approval. Returns success status, path, number of changes made, and backup path.',
        inputSchema: EditFileInputSchema,

        /**
         * Check if this edit operation needs directory access approval.
         * Returns custom approval request if the file is outside allowed paths.
         */
        getApprovalOverride: (args: unknown): ApprovalRequestDetails | null => {
            const { file_path } = args as EditFileInput;
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
                    operation: 'edit',
                    toolName: 'edit_file',
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
         * Generate preview for approval UI - shows diff without modifying file
         * Throws ToolError.validationFailed() for validation errors (file not found, string not found)
         */
        generatePreview: async (input: unknown, _context?: ToolExecutionContext) => {
            const { file_path, old_string, new_string, replace_all } = input as EditFileInput;

            try {
                // Read current file content
                const originalFile = await fileSystemService.readFile(file_path);
                const originalContent = originalFile.content;

                // Validate uniqueness constraint when replace_all is false
                if (!replace_all) {
                    const occurrences = originalContent.split(old_string).length - 1;
                    if (occurrences > 1) {
                        throw ToolError.validationFailed(
                            'edit_file',
                            `String found ${occurrences} times in file. Set replace_all=true to replace all, or provide more context to make old_string unique.`,
                            { file_path, occurrences }
                        );
                    }
                }

                // Compute what the new content would be
                const newContent = replace_all
                    ? originalContent.split(old_string).join(new_string)
                    : originalContent.replace(old_string, new_string);

                // If no change, old_string was not found - throw validation error
                if (originalContent === newContent) {
                    throw ToolError.validationFailed(
                        'edit_file',
                        `String not found in file: "${old_string.slice(0, 50)}${old_string.length > 50 ? '...' : ''}"`,
                        { file_path, old_string_preview: old_string.slice(0, 100) }
                    );
                }

                return generateDiffPreview(file_path, originalContent, newContent);
            } catch (error) {
                // Re-throw validation errors as-is
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === ToolErrorCode.VALIDATION_FAILED
                ) {
                    throw error;
                }
                // Convert filesystem errors (file not found, etc.) to validation errors
                if (error instanceof DextoRuntimeError) {
                    throw ToolError.validationFailed('edit_file', error.message, {
                        file_path,
                        originalErrorCode: error.code,
                    });
                }
                // Unexpected errors - return null to allow approval to proceed
                return null;
            }
        },

        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { file_path, old_string, new_string, replace_all } = input as EditFileInput;

            // Read original content before editing (for diff generation)
            const originalFile = await fileSystemService.readFile(file_path);
            const originalContent = originalFile.content;

            // Edit file using FileSystemService
            // Backup behavior is controlled by config.enableBackups (default: false)
            const result = await fileSystemService.editFile(file_path, {
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all,
            });

            // Read new content after editing (for diff generation)
            const newFile = await fileSystemService.readFile(file_path);
            const newContent = newFile.content;

            // Generate display data using shared helper
            const _display = generateDiffPreview(file_path, originalContent, newContent);

            return {
                success: result.success,
                path: result.path,
                changes_count: result.changesCount,
                ...(result.backupPath && { backup_path: result.backupPath }),
                _display,
            };
        },
    };
}
