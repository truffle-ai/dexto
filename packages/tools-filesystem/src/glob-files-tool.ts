/**
 * Glob Files Tool
 *
 * Internal tool for finding files using glob patterns
 */

import * as path from 'node:path';
import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { SearchDisplayData } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';

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

/**
 * Create the glob_files internal tool with directory approval support
 */
export function createGlobFilesTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof GlobFilesInputSchema> {
    return defineTool({
        id: 'glob_files',
        aliases: ['glob'],
        description:
            'Find files matching a glob pattern. Supports standard glob syntax like **/*.js for recursive matches, *.ts for files in current directory, and src/**/*.tsx for nested paths. Returns array of file paths with metadata (size, modified date). Results are limited to allowed paths only.',
        inputSchema: GlobFilesInputSchema,

        presentation: {
            describeHeader: (input) => {
                const bits = [`pattern=${input.pattern}`];
                if (input.path) bits.push(`path=${input.path}`);
                if (typeof input.max_results === 'number') bits.push(`max=${input.max_results}`);

                return createLocalToolCallHeader({
                    title: 'Find Files',
                    argsText: truncateForHeader(bits.join(', '), 140),
                });
            },
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'glob_files',
            operation: 'read',
            inputSchema: GlobFilesInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) => {
                const baseDir = fileSystemService.getWorkingDirectory();
                const searchDir = path.resolve(baseDir, input.path || '.');
                return { path: searchDir, parentDir: searchDir };
            },
        }),

        async execute(input, context: ToolExecutionContext) {
            const resolvedFileSystemService = await getFileSystemService(context);

            // Input is validated by provider before reaching here
            const { pattern, path: searchPath, max_results } = input;

            // Resolve the search directory consistently with directory-approval path handling
            const baseDir = resolvedFileSystemService.getWorkingDirectory();
            const resolvedSearchPath = path.resolve(baseDir, searchPath || '.');

            // Search for files using FileSystemService
            const result = await resolvedFileSystemService.globFiles(pattern, {
                cwd: resolvedSearchPath,
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
    });
}
