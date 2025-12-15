/**
 * Edit File Tool
 *
 * Internal tool for editing files by replacing text (requires approval)
 */

import { z } from 'zod';
import { createPatch } from 'diff';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService } from '../../../filesystem/index.js';
import type { DiffDisplayData } from '../../display-types.js';

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

            // Read original content before editing (for diff generation)
            const originalFile = await fileSystemService.readFile(file_path);
            const originalContent = originalFile.content;

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

            // Read new content after editing (for diff generation)
            const newFile = await fileSystemService.readFile(file_path);
            const newContent = newFile.content;

            // Generate unified diff
            const unified = createPatch(file_path, originalContent, newContent, 'before', 'after', {
                context: 3,
            });

            // Count additions and deletions from diff
            const additions = (unified.match(/^\+[^+]/gm) || []).length;
            const deletions = (unified.match(/^-[^-]/gm) || []).length;

            // Build display data
            const _display: DiffDisplayData = {
                type: 'diff',
                unified,
                filename: file_path,
                additions,
                deletions,
            };

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
