/**
 * Read Media File Tool
 *
 * Internal tool for reading media or binary files as base64 with MIME metadata.
 */

import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { FileDisplayData, Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers, resolveFilePath } from './directory-approval.js';

const ReadMediaFileInputSchema = z
    .object({
        file_path: z
            .string()
            .min(1)
            .describe('Absolute path to the image, audio, video, PDF, or binary file to read'),
    })
    .strict();

export function createReadMediaFileTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof ReadMediaFileInputSchema> {
    return defineTool({
        id: 'read_media_file',
        aliases: ['read_media'],
        description:
            'Read an image, audio, video, PDF, or other binary file. Returns MIME-aware base64 data using media/file shapes that multimodal UIs can render directly. Use read_file for UTF-8 text files.',
        inputSchema: ReadMediaFileInputSchema,

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Read Media',
                    argsText: truncateForHeader(input.file_path, 140),
                }),
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'read_media_file',
            operation: 'read',
            inputSchema: ReadMediaFileInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) =>
                resolveFilePath(fileSystemService.getWorkingDirectory(), input.file_path),
        }),

        async execute(input, context: ToolExecutionContext) {
            const resolvedFileSystemService = await getFileSystemService(context);
            const { file_path } = input;
            const { path: resolvedPath } = resolveFilePath(
                resolvedFileSystemService.getWorkingDirectory(),
                file_path
            );

            const result = await resolvedFileSystemService.readMediaFile(resolvedPath);

            const _display: FileDisplayData = {
                type: 'file',
                path: resolvedPath,
                operation: 'read',
                size: result.size,
            };

            const item =
                result.kind === 'image'
                    ? {
                          type: 'image' as const,
                          data: result.data,
                          mimeType: result.mimeType,
                          filename: result.filename,
                      }
                    : {
                          type: 'file' as const,
                          data: result.data,
                          mimeType: result.mimeType,
                          filename: result.filename,
                      };

            return {
                content: [item],
                mimeType: result.mimeType,
                filename: result.filename,
                size: result.size,
                _display,
            };
        },
    });
}
