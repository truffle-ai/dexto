/**
 * Grep Content Tool
 *
 * Internal tool for searching file contents using regex patterns
 */

import * as path from 'node:path';
import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { SearchDisplayData } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';

const GrepContentInputSchema = z
    .object({
        pattern: z.string().describe('Regular expression pattern to search for'),
        path: z
            .string()
            .optional()
            .describe('Directory to search in (defaults to working directory)'),
        glob: z
            .string()
            .optional()
            .describe('Glob pattern to filter files (e.g., "*.ts", "**/*.js")'),
        context_lines: z
            .number()
            .int()
            .min(0)
            .optional()
            .default(0)
            .describe(
                'Number of context lines to include before and after each match (default: 0)'
            ),
        case_insensitive: z
            .boolean()
            .optional()
            .default(false)
            .describe('Perform case-insensitive search (default: false)'),
        max_results: z
            .number()
            .int()
            .positive()
            .optional()
            .default(100)
            .describe('Maximum number of results to return (default: 100)'),
    })
    .strict();

/**
 * Create the grep_content internal tool with directory approval support
 */
export function createGrepContentTool(
    getFileSystemService: FileSystemServiceGetter
): Tool<typeof GrepContentInputSchema> {
    return defineTool({
        id: 'grep_content',
        aliases: ['grep'],
        description:
            'Search for text patterns in files using regular expressions. Returns matching lines with file path, line number, and optional context lines. Use glob parameter to filter specific file types (e.g., "*.ts"). Supports case-insensitive search. Great for finding code patterns, function definitions, or specific text across multiple files.',
        inputSchema: GrepContentInputSchema,

        presentation: {
            describeHeader: (input) => {
                const bits = [`pattern=${input.pattern}`];
                if (input.glob) bits.push(`glob=${input.glob}`);
                if (input.path) bits.push(`path=${input.path}`);
                if (typeof input.max_results === 'number') bits.push(`max=${input.max_results}`);

                return createLocalToolCallHeader({
                    title: 'Search Files',
                    argsText: truncateForHeader(bits.join(', '), 140),
                });
            },
        },

        ...createDirectoryAccessApprovalHandlers({
            toolName: 'grep_content',
            operation: 'read',
            inputSchema: GrepContentInputSchema,
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
            const {
                pattern,
                path: searchPath,
                glob,
                context_lines,
                case_insensitive,
                max_results,
            } = input;
            const baseDir = resolvedFileSystemService.getWorkingDirectory();
            const resolvedSearchPath = path.resolve(baseDir, searchPath || '.');

            // Search for content using FileSystemService
            const result = await resolvedFileSystemService.searchContent(pattern, {
                path: resolvedSearchPath,
                glob,
                contextLines: context_lines,
                caseInsensitive: case_insensitive,
                maxResults: max_results,
            });

            // Build display data
            const _display: SearchDisplayData = {
                type: 'search',
                pattern,
                matches: result.matches.map((match) => ({
                    file: match.file,
                    line: match.lineNumber,
                    content: match.line,
                    ...(match.context && {
                        context: [...match.context.before, ...match.context.after],
                    }),
                })),
                totalMatches: result.totalMatches,
                truncated: result.truncated,
            };

            return {
                matches: result.matches.map((match) => ({
                    file: match.file,
                    line_number: match.lineNumber,
                    line: match.line,
                    ...(match.context && {
                        context: {
                            before: match.context.before,
                            after: match.context.after,
                        },
                    }),
                })),
                total_matches: result.totalMatches,
                files_searched: result.filesSearched,
                truncated: result.truncated,
                _display,
            };
        },
    });
}
