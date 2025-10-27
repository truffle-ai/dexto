/**
 * Write File Tool
 *
 * Internal tool for writing content to files (requires approval)
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService, BufferEncoding } from '../../../filesystem/index.js';

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
 * Create the write_file internal tool
 */
export function createWriteFileTool(fileSystemService: FileSystemService): InternalTool {
    return {
        id: 'write_file',
        description:
            'Write content to a file. Creates a new file or overwrites existing file. Automatically creates backup of existing files before overwriting. Use create_dirs to create parent directories. Requires approval for all write operations. Returns success status, path, bytes written, and backup path if applicable.',
        inputSchema: WriteFileInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { file_path, content, create_dirs, encoding } = input as WriteFileInput;

            // Write file using FileSystemService
            const result = await fileSystemService.writeFile(file_path, content, {
                createDirs: create_dirs,
                encoding: encoding as BufferEncoding,
                backup: true, // Always create backup for internal tools
            });

            return {
                success: result.success,
                path: result.path,
                bytes_written: result.bytesWritten,
                ...(result.backupPath && { backup_path: result.backupPath }),
            };
        },
    };
}
