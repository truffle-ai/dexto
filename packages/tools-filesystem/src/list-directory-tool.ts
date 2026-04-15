import * as path from 'node:path';
import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { SearchDisplayData, Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';

const ListDirectoryInputSchema = z
    .object({
        path: z
            .string()
            .optional()
            .describe('Directory to list (defaults to the working directory)'),
        include_hidden: z
            .boolean()
            .optional()
            .default(true)
            .describe('Include hidden files and directories (default: true)'),
        include_metadata: z
            .boolean()
            .optional()
            .default(false)
            .describe('Include entry size and modified time metadata (default: false)'),
        max_entries: z
            .number()
            .int()
            .positive()
            .optional()
            .default(200)
            .describe('Maximum number of entries to return (default: 200)'),
    })
    .strict();

export function createListDirectoryTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof ListDirectoryInputSchema> {
    return defineTool({
        id: 'list_directory',
        description:
            'List the direct children of a directory without reading file contents. Use this before broader glob or grep searches when you need a quick map of a folder.',
        inputSchema: ListDirectoryInputSchema,

        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'List Directory',
                    argsText: truncateForHeader(input.path ?? '.', 140),
                }),
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'list_directory',
            operation: 'read',
            inputSchema: ListDirectoryInputSchema,
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

            const result = await fileSystemService.listDirectory(resolvedPath, {
                includeHidden: input.include_hidden,
                includeMetadata: input.include_metadata,
                maxEntries: input.max_entries,
            });

            const _display: SearchDisplayData = {
                type: 'search',
                pattern: result.path,
                matches: result.entries.map((entry) => ({
                    file: entry.path,
                    line: 0,
                    content: entry.name,
                })),
                totalMatches: result.totalEntries,
                truncated: result.truncated,
            };

            return {
                path: result.path,
                entries: result.entries.map((entry) => ({
                    name: entry.name,
                    path: entry.path,
                    is_directory: entry.isDirectory,
                    ...(input.include_metadata
                        ? {
                              size: entry.size,
                              modified: entry.modified.toISOString(),
                          }
                        : {}),
                })),
                total_entries: result.totalEntries,
                truncated: result.truncated,
                _display,
            };
        },
    });
}
