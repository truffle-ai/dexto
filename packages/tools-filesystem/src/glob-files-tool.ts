/**
 * Glob Files Tool
 *
 * Internal tool for finding files using glob patterns
 */

import { z } from 'zod';
import {
    TOOL_ACTIVITY,
    createLocalToolCallHeader,
    defineTool,
    truncateForHeader,
} from '@dexto/core/tools';
import type { SearchDisplayData, Tool, ToolExecutionContext } from '@dexto/core/tools';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';
import { resolveUserPath } from './path-utils.js';
import { assertWorkspaceRelativeGlob, toWorkspaceRelativePath } from './workspace-paths.js';

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
            activity: TOOL_ACTIVITY.searchFiles,
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
                const searchDir = resolveUserPath(baseDir, input.path || '.');
                return { path: searchDir, parentDir: searchDir };
            },
        }),

        async execute(input, context: ToolExecutionContext) {
            const { pattern, path: searchPath, max_results } = input;
            if (!context.services) {
                throw new Error('glob_files requires ToolExecutionContext.services');
            }
            const handle = await context.services.workspaceManager.open({ intent: 'read' });
            const workspacePattern = joinWorkspacePattern(handle.context.path, searchPath, pattern);
            const matches = await handle.files.glob(workspacePattern);
            const limitedMatches = matches.slice(0, max_results);
            const truncated = matches.length > max_results;

            // Build display data (reuse SearchDisplayData for file list)
            const _display: SearchDisplayData = {
                type: 'search',
                pattern,
                matches: limitedMatches.map((file) => ({
                    file,
                    line: 0, // No line number for glob
                    content: file,
                })),
                totalMatches: limitedMatches.length,
                truncated,
            };

            return {
                files: limitedMatches.map((filePath) => ({ path: filePath })),
                total_found: limitedMatches.length,
                truncated,
                _display,
            };
        },
    });
}

function joinWorkspacePattern(
    workspaceRoot: string,
    searchPath: string | undefined,
    pattern: string
): string {
    assertWorkspaceRelativeGlob('glob_files', pattern);
    const basePath = toWorkspaceRelativePath('glob_files', workspaceRoot, searchPath || '.');
    if (basePath === '.' || basePath === '') return pattern;
    return `${basePath.replace(/\/$/, '')}/${pattern}`;
}
