/**
 * Edit File Tool
 *
 * Internal tool for editing files by replacing text (requires approval)
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPatch } from 'diff';
import { Tool, ToolExecutionContext, ApprovalType } from '@dexto/core';
import type { DiffDisplayData, ApprovalRequestDetails, ApprovalResponse } from '@dexto/core';
import { ToolError } from '@dexto/core';
import { ToolErrorCode } from '@dexto/core';
import { DextoRuntimeError } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { FileSystemErrorCode } from './error-codes.js';

/**
 * Cache for content hashes between preview and execute phases.
 * Keyed by toolCallId to ensure proper cleanup after execution.
 * This prevents file corruption when user modifies file between preview and execute.
 */
const previewContentHashCache = new Map<string, string>();

/**
 * Compute SHA-256 hash of content for change detection
 */
function computeContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

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
export function createEditFileTool(getFileSystemService: FileSystemServiceGetter): Tool {
    // Store parent directory for use in onApprovalGranted callback
    let pendingApprovalParentDir: string | undefined;

    return {
        id: 'edit_file',
        displayName: 'Update',
        aliases: ['edit'],
        description:
            'Edit a file by replacing text. By default, old_string must be unique in the file (will error if found multiple times). Set replace_all=true to replace all occurrences. Automatically creates backup before editing. Requires approval. Returns success status, path, number of changes made, and backup path.',
        inputSchema: EditFileInputSchema,

        /**
         * Check if this edit operation needs directory access approval.
         * Returns custom approval request if the file is outside allowed paths.
         */
        getApprovalOverride: async (
            args: unknown,
            context: ToolExecutionContext
        ): Promise<ApprovalRequestDetails | null> => {
            const { file_path } = args as EditFileInput;
            if (!file_path) return null;

            const resolvedFileSystemService = await getFileSystemService(context);

            // Check if path is within config-allowed paths (async for non-blocking symlink resolution)
            const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(file_path);
            if (isAllowed) {
                return null; // Use normal tool confirmation
            }

            // Check if directory is already session-approved (prompting decision)
            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'edit_file requires ToolExecutionContext.services.approval'
                );
            }
            if (approvalManager.isDirectorySessionApproved(file_path)) {
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
        onApprovalGranted: (response: ApprovalResponse, context: ToolExecutionContext): void => {
            if (!pendingApprovalParentDir) return;

            // Check if user wants to remember the directory
            // Use type assertion to access rememberDirectory since response.data is a union type
            const data = response.data as { rememberDirectory?: boolean } | undefined;
            const rememberDirectory = data?.rememberDirectory ?? false;

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'edit_file requires ToolExecutionContext.services.approval'
                );
            }
            approvalManager.addApprovedDirectory(
                pendingApprovalParentDir,
                rememberDirectory ? 'session' : 'once'
            );

            // Clear pending state
            pendingApprovalParentDir = undefined;
        },

        /**
         * Generate preview for approval UI - shows diff without modifying file
         * Throws ToolError.validationFailed() for validation errors (file not found, string not found)
         * Stores content hash for change detection in execute phase.
         */
        generatePreview: async (input: unknown, context: ToolExecutionContext) => {
            const { file_path, old_string, new_string, replace_all } = input as EditFileInput;

            const resolvedFileSystemService = await getFileSystemService(context);

            try {
                // Read current file content
                const originalFile = await resolvedFileSystemService.readFile(file_path);
                const originalContent = originalFile.content;

                // Store content hash for change detection in execute phase
                if (context.toolCallId) {
                    previewContentHashCache.set(
                        context.toolCallId,
                        computeContentHash(originalContent)
                    );
                }

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

        execute: async (input: unknown, context: ToolExecutionContext) => {
            const resolvedFileSystemService = await getFileSystemService(context);

            // Input is validated by provider before reaching here
            const { file_path, old_string, new_string, replace_all } = input as EditFileInput;

            // Check if file was modified since preview (safety check)
            // This prevents corrupting user edits made between preview approval and execution
            const toolCallId = context.toolCallId;
            if (toolCallId) {
                const expectedHash = previewContentHashCache.get(toolCallId);
                if (expectedHash === undefined) {
                    // No preview hash stored for this toolCallId, skip modification check.
                    // This can happen if generatePreview was not called or caching was cleared.
                } else {
                    previewContentHashCache.delete(toolCallId); // Clean up regardless of outcome

                    // Read current content to verify it hasn't changed
                    let currentContent: string;
                    try {
                        const currentFile = await resolvedFileSystemService.readFile(file_path);
                        currentContent = currentFile.content;
                    } catch (error) {
                        // File was deleted between preview and execute - treat as modified
                        if (
                            error instanceof DextoRuntimeError &&
                            error.code === FileSystemErrorCode.FILE_NOT_FOUND
                        ) {
                            throw ToolError.fileModifiedSincePreview('edit_file', file_path);
                        }
                        throw error;
                    }
                    const currentHash = computeContentHash(currentContent);

                    if (expectedHash !== currentHash) {
                        throw ToolError.fileModifiedSincePreview('edit_file', file_path);
                    }
                }
            }

            // Edit file using FileSystemService
            // Backup behavior is controlled by config.enableBackups (default: false)
            // editFile returns originalContent and newContent, eliminating extra file reads
            const result = await resolvedFileSystemService.editFile(file_path, {
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all,
            });

            // Generate display data using content returned from editFile
            const _display = generateDiffPreview(
                file_path,
                result.originalContent,
                result.newContent
            );

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
