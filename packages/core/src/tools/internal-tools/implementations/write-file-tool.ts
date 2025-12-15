/**
 * Write File Tool
 *
 * Internal tool for writing content to files (requires approval)
 */

import { z } from 'zod';
import { createPatch } from 'diff';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService, BufferEncoding } from '../../../filesystem/index.js';
import type { DiffDisplayData, FileDisplayData } from '../../display-types.js';

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

            // Check if file exists (for diff generation)
            let originalContent: string | null = null;
            try {
                const originalFile = await fileSystemService.readFile(file_path);
                originalContent = originalFile.content;
            } catch {
                // File doesn't exist - this is a create operation
                originalContent = null;
            }

            // Write file using FileSystemService
            const result = await fileSystemService.writeFile(file_path, content, {
                createDirs: create_dirs,
                encoding: encoding as BufferEncoding,
                backup: true, // Always create backup for internal tools
            });

            // Build display data based on operation type
            let _display: DiffDisplayData | FileDisplayData;

            if (originalContent === null) {
                // New file creation
                _display = {
                    type: 'file',
                    path: file_path,
                    operation: 'create',
                    size: result.bytesWritten,
                };
            } else {
                // File overwrite - generate diff
                const unified = createPatch(
                    file_path,
                    originalContent,
                    content,
                    'before',
                    'after',
                    {
                        context: 3,
                    }
                );
                const additions = (unified.match(/^\+[^+]/gm) || []).length;
                const deletions = (unified.match(/^-[^-]/gm) || []).length;

                _display = {
                    type: 'diff',
                    unified,
                    filename: file_path,
                    additions,
                    deletions,
                };
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
