/**
 * Write File Tool
 *
 * Internal tool for writing content to files (requires approval)
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPatch } from 'diff';
import {
    createLocalToolCallHeader,
    ToolError,
    defineTool,
    truncateForHeader,
} from '@dexto/core/tools';
import { DextoRuntimeError } from '@dexto/core/errors';
import type {
    DiffDisplayData,
    FileDisplayData,
    Tool,
    ToolExecutionContext,
} from '@dexto/core/tools';
import { FileSystemErrorCode } from './error-codes.js';
import { BufferEncoding } from './types.js';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers, resolveFilePath } from './directory-approval.js';
import { isWorkspaceFileNotFound, toWorkspaceRelativePath } from './workspace-paths.js';

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
        file_path: z
            .string()
            .min(1)
            .describe(
                'Path where the file should be written. Relative paths resolve inside the active workspace; absolute paths must stay inside the active workspace.'
            ),
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
        title: 'Update file',
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
        aliases: ['write'],
        description:
            'Write content to a file inside the active workspace. Creates a new file or overwrites an existing file. Relative paths resolve inside the workspace; absolute paths must stay inside it. Use create_dirs=true to create missing parent directories. Requires approval for all write operations. Returns success status, path, bytes written, and display data.',
        inputSchema: WriteFileInputSchema,

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'write_file',
            operation: 'write',
            inputSchema: WriteFileInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) =>
                resolveFilePath(fileSystemService.getWorkingDirectory(), input.file_path),
        }),

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Write',
                    argsText: truncateForHeader(input.file_path, 140),
                }),

            /**
             * Generate preview for approval UI - shows diff or file creation info
             * Stores content hash for change detection in execute phase.
             */
            preview: async (input, context: ToolExecutionContext) => {
                const { file_path, content } = input;
                const workspaceManager = context.services?.workspaceManager;
                if (workspaceManager !== undefined) {
                    const handle = await workspaceManager.open({ intent: 'write' });
                    const workspacePath = toWorkspaceRelativePath(
                        'write_file',
                        handle.context.path,
                        file_path
                    );
                    try {
                        const originalContent = await handle.files.readText(workspacePath);
                        if (context.toolCallId) {
                            previewContentHashCache.set(
                                context.toolCallId,
                                computeContentHash(originalContent)
                            );
                        }
                        return generateDiffPreview(file_path, originalContent, content);
                    } catch (error) {
                        if (!isWorkspaceFileNotFound(error)) {
                            throw error;
                        }
                        if (context.toolCallId) {
                            previewContentHashCache.set(context.toolCallId, FILE_NOT_EXISTS_MARKER);
                        }
                        return {
                            type: 'file',
                            title: 'Create file',
                            path: file_path,
                            operation: 'create',
                            size: Buffer.byteLength(content, 'utf8'),
                            lineCount: content.split('\n').length,
                            content,
                        } satisfies FileDisplayData;
                    }
                }

                const resolvedFileSystemService = await getFileSystemService(context);
                const { path: resolvedPath } = resolveFilePath(
                    resolvedFileSystemService.getWorkingDirectory(),
                    file_path
                );

                try {
                    // Try to read existing file
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

                    // File exists - show diff preview
                    return generateDiffPreview(resolvedPath, originalContent, content);
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
                            title: 'Create file',
                            path: resolvedPath,
                            operation: 'create',
                            size: Buffer.byteLength(content, 'utf8'),
                            lineCount,
                            content, // Include content for approval preview
                        };
                        return preview;
                    }
                    // Permission denied, I/O errors, etc. - rethrow
                    throw error;
                }
            },
        },

        async execute(input, context: ToolExecutionContext) {
            const { file_path, content, create_dirs, encoding } = input;
            const handle = await openWorkspace(context, 'write_file');
            const workspacePath = toWorkspaceRelativePath(
                'write_file',
                handle.context.path,
                file_path
            );

            // Check if file was modified since preview (safety check)
            // This prevents corrupting user edits made between preview approval and execution
            let originalContent: string | null = null;
            let fileExistsNow = false;

            try {
                originalContent = await handle.files.readText(workspacePath);
                fileExistsNow = true;
            } catch (error) {
                if (!isWorkspaceFileNotFound(error)) {
                    throw error;
                }
                originalContent = null;
                fileExistsNow = false;
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

            try {
                await handle.files.writeFile(workspacePath, content, { createDirs: create_dirs });
            } catch (error) {
                if (isWorkspaceFileNotFound(error) && !create_dirs) {
                    throw ToolError.executionFailed(
                        'write_file',
                        `Parent directory for '${file_path}' does not exist. Retry with create_dirs=true to create missing directories.`
                    );
                }
                throw error;
            }
            const bytesWritten = Buffer.byteLength(content, encoding as BufferEncoding);

            // Build display data based on operation type
            let _display: DiffDisplayData | FileDisplayData;

            if (originalContent === null) {
                // New file creation
                const lineCount = content.split('\n').length;
                _display = {
                    type: 'file',
                    title: 'Create file',
                    path: file_path,
                    operation: 'create',
                    size: bytesWritten,
                    lineCount,
                    content,
                };
            } else {
                // File overwrite - generate diff using shared helper
                _display = generateDiffPreview(file_path, originalContent, content);
            }

            return {
                success: true,
                path: file_path,
                bytes_written: bytesWritten,
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
