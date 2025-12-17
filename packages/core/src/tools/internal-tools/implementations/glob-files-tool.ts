/**
 * Glob Files Tool
 *
 * Internal tool for finding files using glob patterns
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService } from '../../../filesystem/index.js';
import type { SearchDisplayData } from '../../display-types.js';

const GlobFilesInputSchema = z
    .object({
        pattern: z
            .string()
            .describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")'),
        path: z
            .string()
            .optional()
            .describe('Base directory to search from (defaults to working directory)'),
        max_results: z
            .number()
            .int()
            .positive()
            .optional()
            .default(1000)
            .describe('Maximum number of results to return (default: 1000)'),
    })
    .strict();

type GlobFilesInput = z.input<typeof GlobFilesInputSchema>;

/**
 * Create the glob_files internal tool
 */
export function createGlobFilesTool(fileSystemService: FileSystemService): InternalTool {
    return {
        id: 'glob_files',
        description:
            'Find files matching a glob pattern. Supports standard glob syntax like **/*.js for recursive matches, *.ts for files in current directory, and src/**/*.tsx for nested paths. Returns array of file paths with metadata (size, modified date). Results are limited to allowed paths only.',
        inputSchema: GlobFilesInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { pattern, path, max_results } = input as GlobFilesInput;

            // Search for files using FileSystemService
            const result = await fileSystemService.globFiles(pattern, {
                cwd: path,
                maxResults: max_results,
                includeMetadata: true,
            });

            // Build display data (reuse SearchDisplayData for file list)
            const _display: SearchDisplayData = {
                type: 'search',
                pattern,
                matches: result.files.map((file) => ({
                    file: file.path,
                    line: 0, // No line number for glob
                    content: file.path,
                })),
                totalMatches: result.totalFound,
                truncated: result.truncated,
            };

            return {
                files: result.files.map((file) => ({
                    path: file.path,
                    size: file.size,
                    modified: file.modified.toISOString(),
                })),
                total_found: result.totalFound,
                truncated: result.truncated,
                _display,
            };
        },
    };
}
