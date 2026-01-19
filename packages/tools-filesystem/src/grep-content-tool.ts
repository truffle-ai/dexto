/**
 * Grep Content Tool
 *
 * Internal tool for searching file contents using regex patterns
 */

import * as path from 'node:path';
import { z } from 'zod';
import { InternalTool, ToolExecutionContext, ApprovalType } from '@dexto/core';
import type { SearchDisplayData, ApprovalRequestDetails, ApprovalResponse } from '@dexto/core';
import type { FileToolOptions } from './file-tool-types.js';

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

type GrepContentInput = z.input<typeof GrepContentInputSchema>;

/**
 * Create the grep_content internal tool with directory approval support
 */
export function createGrepContentTool(options: FileToolOptions): InternalTool {
    const { fileSystemService, directoryApproval } = options;

    // Store search directory for use in onApprovalGranted callback
    let pendingApprovalSearchDir: string | undefined;

    return {
        id: 'grep_content',
        description:
            'Search for text patterns in files using regular expressions. Returns matching lines with file path, line number, and optional context lines. Use glob parameter to filter specific file types (e.g., "*.ts"). Supports case-insensitive search. Great for finding code patterns, function definitions, or specific text across multiple files.',
        inputSchema: GrepContentInputSchema,

        /**
         * Check if this grep operation needs directory access approval.
         * Returns custom approval request if the search directory is outside allowed paths.
         */
        getApprovalOverride: async (args: unknown): Promise<ApprovalRequestDetails | null> => {
            const { path: searchPath } = args as GrepContentInput;

            // Resolve the search directory (use cwd if not specified)
            const searchDir = path.resolve(searchPath || process.cwd());

            // Check if path is within config-allowed paths
            const isAllowed = await fileSystemService.isPathWithinConfigAllowed(searchDir);
            if (isAllowed) {
                return null; // Use normal tool confirmation
            }

            // Check if directory is already session-approved
            if (directoryApproval?.isSessionApproved(searchDir)) {
                return null; // Already approved, use normal flow
            }

            // Need directory access approval
            pendingApprovalSearchDir = searchDir;

            return {
                type: ApprovalType.DIRECTORY_ACCESS,
                metadata: {
                    path: searchDir,
                    parentDir: searchDir,
                    operation: 'search',
                    toolName: 'grep_content',
                },
            };
        },

        /**
         * Handle approved directory access - remember the directory for session
         */
        onApprovalGranted: (response: ApprovalResponse): void => {
            if (!directoryApproval || !pendingApprovalSearchDir) return;

            // Check if user wants to remember the directory
            const data = response.data as { rememberDirectory?: boolean } | undefined;
            const rememberDirectory = data?.rememberDirectory ?? false;
            directoryApproval.addApproved(
                pendingApprovalSearchDir,
                rememberDirectory ? 'session' : 'once'
            );

            // Clear pending state
            pendingApprovalSearchDir = undefined;
        },

        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { pattern, path, glob, context_lines, case_insensitive, max_results } =
                input as GrepContentInput;

            // Search for content using FileSystemService
            const result = await fileSystemService.searchContent(pattern, {
                path,
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
    };
}
