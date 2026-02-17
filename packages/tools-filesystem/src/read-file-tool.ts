/**
 * Read File Tool
 *
 * Internal tool for reading file contents with size limits and pagination
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { FileDisplayData, Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers, resolveFilePath } from './directory-approval.js';

const ReadFileInputSchema = z
    .object({
        file_path: z.string().min(1).describe('Absolute path to the file to read'),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum number of lines to read (optional)'),
        offset: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Starting line number (1-based, optional)'),
    })
    .strict();

/**
 * Create the read_file internal tool with directory approval support
 */
export function createReadFileTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof ReadFileInputSchema> {
    return defineTool({
        id: 'read_file',
        displayName: 'Read',
        aliases: ['read'],
        description:
            'Read the contents of a file with optional pagination. Returns file content, line count, encoding, and whether the output was truncated. Use limit and offset parameters for large files to read specific sections. This tool is for reading files within allowed paths only.',
        inputSchema: ReadFileInputSchema,

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'read_file',
            operation: 'read',
            getFileSystemService,
            resolvePaths: (input, fileSystemService) =>
                resolveFilePath(fileSystemService.getWorkingDirectory(), input.file_path),
        }),

        async execute(input, context: ToolExecutionContext) {
            const resolvedFileSystemService = await getFileSystemService(context);

            // Input is validated by provider before reaching here
            const { file_path, limit, offset } = input;
            const { path: resolvedPath } = resolveFilePath(
                resolvedFileSystemService.getWorkingDirectory(),
                file_path
            );

            // Read file using FileSystemService
            const result = await resolvedFileSystemService.readFile(resolvedPath, {
                limit,
                offset,
            });

            // Build display data
            const _display: FileDisplayData = {
                type: 'file',
                path: resolvedPath,
                operation: 'read',
                size: result.size,
                lineCount: result.lines,
            };

            return {
                content: result.content,
                lines: result.lines,
                encoding: result.encoding,
                truncated: result.truncated,
                size: result.size,
                ...(result.mimeType && { mimeType: result.mimeType }),
                _display,
            };
        },
    });
}
