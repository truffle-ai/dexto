/**
 * Edit File Tool
 *
 * Internal tool for editing files by replacing text (requires approval)
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPatch } from 'diff';
import {
    createLocalToolCallHeader,
    ToolError,
    ToolErrorCode,
    defineTool,
    truncateForHeader,
} from '@dexto/core/tools';
import { DextoRuntimeError } from '@dexto/core/errors';
import type { DiffDisplayData, Tool, ToolExecutionContext } from '@dexto/core/tools';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { FileSystemErrorCode } from './error-codes.js';
import { createDirectoryAccessApprovalHandlers, resolveFilePath } from './directory-approval.js';
import { toWorkspaceRelativePath } from './workspace-paths.js';

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
        file_path: z.string().min(1).describe('Absolute path to the file to edit'),
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
        title: 'Update file',
        unified,
        filename: filePath,
        additions,
        deletions,
    };
}

/**
 * Create the edit_file internal tool with directory approval support
 */
export function createEditFileTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof EditFileInputSchema> {
    return defineTool({
        id: 'edit_file',
        aliases: ['edit'],
        description:
            'Edit a file by replacing text. By default, old_string must be unique in the file (will error if found multiple times). Set replace_all=true to replace all occurrences. Automatically creates backup before editing. Requires approval. Returns success status, path, number of changes made, and backup path.',
        inputSchema: EditFileInputSchema,

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'edit_file',
            operation: 'edit',
            inputSchema: EditFileInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) =>
                resolveFilePath(fileSystemService.getWorkingDirectory(), input.file_path),
        }),

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Update',
                    argsText: truncateForHeader(input.file_path, 140),
                }),

            /**
             * Generate preview for approval UI - shows diff without modifying file
             * Throws ToolError.validationFailed() for validation errors (file not found, string not found)
             * Stores content hash for change detection in execute phase.
             */
            preview: async (input, context: ToolExecutionContext) => {
                const { file_path, old_string, new_string, replace_all } = input;

                const resolvedFileSystemService = await getFileSystemService(context);
                const { path: resolvedPath } = resolveFilePath(
                    resolvedFileSystemService.getWorkingDirectory(),
                    file_path
                );

                try {
                    // Read current file content
                    let originalContent: string;
                    try {
                        const originalFile = await resolvedFileSystemService.readFile(resolvedPath);
                        originalContent = originalFile.content;
                    } catch (error) {
                        if (
                            error instanceof DextoRuntimeError &&
                            error.code === FileSystemErrorCode.INVALID_PATH
                        ) {
                            const originalFile =
                                await resolvedFileSystemService.readFileForToolPreview(
                                    resolvedPath
                                );
                            originalContent = originalFile.content;
                        } else {
                            throw error;
                        }
                    }

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
                                { file_path: resolvedPath, occurrences }
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
                            {
                                file_path: resolvedPath,
                                old_string_preview: old_string.slice(0, 100),
                            }
                        );
                    }

                    return generateDiffPreview(resolvedPath, originalContent, newContent);
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
                            file_path: resolvedPath,
                            originalErrorCode: error.code,
                        });
                    }
                    // Unexpected errors - return null to allow approval to proceed
                    return null;
                }
            },
        },

        async execute(input, context: ToolExecutionContext) {
            const { file_path, old_string, new_string, replace_all } = input;
            const handle = await openWorkspace(context, 'edit_file');
            const workspacePath = toWorkspaceRelativePath(
                'edit_file',
                handle.context.path,
                file_path
            );

            // Check if file was modified since preview (safety check)
            // This prevents corrupting user edits made between preview approval and execution
            let currentContent = await handle.files.readText(workspacePath);
            const toolCallId = context.toolCallId;
            if (toolCallId) {
                const expectedHash = previewContentHashCache.get(toolCallId);
                if (expectedHash === undefined) {
                    // No preview hash stored for this toolCallId, skip modification check.
                    // This can happen if generatePreview was not called or caching was cleared.
                } else {
                    previewContentHashCache.delete(toolCallId); // Clean up regardless of outcome

                    // Read current content to verify it hasn't changed
                    try {
                        currentContent = await handle.files.readText(workspacePath);
                    } catch {
                        // File was deleted between preview and execute - treat as modified
                        throw ToolError.fileModifiedSincePreview('edit_file', file_path);
                    }
                    const currentHash = computeContentHash(currentContent);

                    if (expectedHash !== currentHash) {
                        throw ToolError.fileModifiedSincePreview('edit_file', file_path);
                    }
                }
            }

            const occurrences = currentContent.split(old_string).length - 1;
            if (occurrences === 0) {
                throw ToolError.validationFailed(
                    'edit_file',
                    `String not found in file: "${old_string.slice(0, 50)}${old_string.length > 50 ? '...' : ''}"`,
                    {
                        file_path,
                        old_string_preview: old_string.slice(0, 100),
                    }
                );
            }
            if (!replace_all && occurrences > 1) {
                throw ToolError.validationFailed(
                    'edit_file',
                    `String found ${occurrences} times in file. Set replace_all=true to replace all, or provide more context to make old_string unique.`,
                    { file_path, occurrences }
                );
            }

            const newContent = replace_all
                ? currentContent.split(old_string).join(new_string)
                : currentContent.replace(old_string, new_string);
            await handle.files.writeFile(workspacePath, newContent);

            const _display = generateDiffPreview(file_path, currentContent, newContent);

            return {
                success: true,
                path: file_path,
                changes_count: occurrences,
                _display,
            };
        },
    });
}

async function openWorkspace(context: ToolExecutionContext, toolName: string) {
    if (!context.services) {
        throw new Error(`${toolName} requires ToolExecutionContext.services`);
    }
    return context.services.workspaceManager.open({ intent: 'write' });
}
