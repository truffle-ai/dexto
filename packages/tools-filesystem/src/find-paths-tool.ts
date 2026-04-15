import * as path from 'node:path';
import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { SearchDisplayData, Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';

const FindPathsInputSchema = z
    .object({
        query: z.string().trim().min(1).describe('Filename or path fragment to search for'),
        path: z
            .string()
            .optional()
            .describe('Base directory to search from (defaults to the working directory)'),
        path_type: z
            .enum(['file', 'directory', 'all'])
            .optional()
            .default('all')
            .describe('Restrict results to files, directories, or both (default: all)'),
        max_results: z
            .number()
            .int()
            .positive()
            .optional()
            .default(100)
            .describe('Maximum number of matches to return (default: 100)'),
    })
    .strict();

export function createFindPathsTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof FindPathsInputSchema> {
    return defineTool({
        id: 'find_paths',
        aliases: ['find'],
        description:
            'Find likely file or directory paths using exact, prefix, substring, and fuzzy matching over the workspace path inventory.',
        inputSchema: FindPathsInputSchema,

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Find Paths',
                    argsText: truncateForHeader(
                        [input.query, input.path ? `path=${input.path}` : null]
                            .filter(Boolean)
                            .join(', '),
                        140
                    ),
                }),
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'find_paths',
            operation: 'read',
            inputSchema: FindPathsInputSchema,
            getFileSystemService,
            resolvePaths: (input, fileSystemService) => {
                const baseDir = fileSystemService.getWorkingDirectory();
                const resolvedPath = path.resolve(baseDir, input.path || '.');
                return { path: resolvedPath, parentDir: resolvedPath };
            },
        }),

        async execute(input, context: ToolExecutionContext) {
            const fileSystemService = await getFileSystemService(context);
            const baseDir = fileSystemService.getWorkingDirectory();
            const resolvedPath = path.resolve(baseDir, input.path || '.');

            const result = await fileSystemService.findPaths(input.query, {
                path: resolvedPath,
                pathType: input.path_type,
                maxResults: input.max_results,
            });

            const _display: SearchDisplayData = {
                type: 'search',
                pattern: input.query,
                matches: result.matches.map((match) => ({
                    file: match.path,
                    line: 0,
                    content: match.path,
                })),
                totalMatches: result.totalMatches,
                truncated: result.truncated,
            };

            return {
                matches: result.matches.map((match) => ({
                    path: match.path,
                    path_type: match.pathType,
                    score: match.score,
                })),
                total_matches: result.totalMatches,
                truncated: result.truncated,
                search_path: result.searchPath,
                _display,
            };
        },
    });
}
