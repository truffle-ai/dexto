/**
 * Read File Tool
 *
 * Internal tool for reading file contents with size limits and pagination
 */

import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core/tools';
import type { FileDisplayData, Tool, ToolExecutionContext } from '@dexto/core/tools';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers, resolveFilePath } from './directory-approval.js';
import type { ReadFileOptions } from './types.js';
import { toWorkspaceRelativePath } from './workspace-paths.js';

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
        aliases: ['read'],
        description:
            'Read the UTF-8 text contents of a file with optional pagination. Returns file content, line count, encoding, MIME type, and whether the output was truncated. Use limit and offset parameters for large files to read specific sections. Use read_media_file for image, audio, video, PDF, and other binary files.',
        inputSchema: ReadFileInputSchema,

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Read',
                    argsText: truncateForHeader(input.file_path, 140),
                }),
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'read_file',
            operation: 'read',
            inputSchema: ReadFileInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) =>
                resolveFilePath(fileSystemService.getWorkingDirectory(), input.file_path),
        }),

        async execute(input, context: ToolExecutionContext) {
            if (!context.services) {
                throw new Error('read_file requires ToolExecutionContext.services');
            }
            const handle = await context.services.workspaceManager.open({ intent: 'read' });
            if (typeof handle.files.readText !== 'function') {
                throw new Error(`Workspace file read unavailable: ${input.file_path}`);
            }

            const workspacePath = toWorkspaceRelativePath(
                'read_file',
                handle.context.path,
                input.file_path
            );
            const content = await handle.files.readText(workspacePath);
            const result = applyLineWindow(content, {
                limit: input.limit,
                offset: input.offset,
            });

            // Build display data
            const _display: FileDisplayData = {
                type: 'file',
                path: input.file_path,
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
                _display,
            };
        },
    });
}

function applyLineWindow(
    content: string,
    options: ReadFileOptions
): {
    content: string;
    lines: number;
    encoding: string;
    truncated: boolean;
    size: number;
} {
    const lines = content.split('\n');
    if (!options.offset && options.limit === undefined) {
        return {
            content,
            lines: lines.length,
            encoding: 'utf-8',
            truncated: false,
            size: Buffer.byteLength(content, 'utf-8'),
        };
    }

    const start = options.offset && options.offset > 0 ? Math.max(0, options.offset - 1) : 0;
    const end = options.limit !== undefined ? start + options.limit : lines.length;
    const selectedContent = lines.slice(start, end).join('\n');
    return {
        content: selectedContent,
        lines: selectedContent.length > 0 ? selectedContent.split('\n').length : 0,
        encoding: 'utf-8',
        truncated: end < lines.length,
        size: Buffer.byteLength(selectedContent, 'utf-8'),
    };
}
