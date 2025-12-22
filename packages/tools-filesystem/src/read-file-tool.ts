/**
 * Read File Tool
 *
 * Internal tool for reading file contents with size limits and pagination
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import type { FileDisplayData } from '@dexto/core';

const ReadFileInputSchema = z
    .object({
        file_path: z.string().describe('Absolute path to the file to read'),
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

type ReadFileInput = z.input<typeof ReadFileInputSchema>;

/**
 * Create the read_file internal tool
 */
export function createReadFileTool(fileSystemService: FileSystemService): InternalTool {
    return {
        id: 'read_file',
        description:
            'Read the contents of a file with optional pagination. Returns file content, line count, encoding, and whether the output was truncated. Use limit and offset parameters for large files to read specific sections. This tool is for reading files within allowed paths only.',
        inputSchema: ReadFileInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { file_path, limit, offset } = input as ReadFileInput;

            // Read file using FileSystemService
            const result = await fileSystemService.readFile(file_path, {
                limit,
                offset,
            });

            // Build display data
            const _display: FileDisplayData = {
                type: 'file',
                path: file_path,
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
    };
}
