/**
 * Edit File Tool
 *
 * Internal tool for editing files by replacing text (requires approval)
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService } from '../../../filesystem/index.js';

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
 * Create the edit_file internal tool
 */
export function createEditFileTool(fileSystemService: FileSystemService): InternalTool {
    return {
        id: 'edit_file',
        description:
            'Edit a file by replacing text. By default, old_string must be unique in the file (will error if found multiple times). Set replace_all=true to replace all occurrences. Automatically creates backup before editing. Requires approval. Returns success status, path, number of changes made, and backup path.',
        inputSchema: EditFileInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { file_path, old_string, new_string, replace_all } = input as EditFileInput;

            // Edit file using FileSystemService
            const result = await fileSystemService.editFile(
                file_path,
                {
                    oldString: old_string,
                    newString: new_string,
                    replaceAll: replace_all,
                },
                {
                    backup: true, // Always create backup for internal tools
                }
            );

            return {
                success: result.success,
                path: result.path,
                changes_count: result.changesCount,
                ...(result.backupPath && { backup_path: result.backupPath }),
            };
        },
    };
}
