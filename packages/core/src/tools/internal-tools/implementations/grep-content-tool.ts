/**
 * Grep Content Tool
 *
 * Internal tool for searching file contents using regex patterns
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { FileSystemService } from '../../../filesystem/index.js';

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
 * Create the grep_content internal tool
 */
export function createGrepContentTool(fileSystemService: FileSystemService): InternalTool {
    return {
        id: 'grep_content',
        description:
            'Search for text patterns in files using regular expressions. Returns matching lines with file path, line number, and optional context lines. Use glob parameter to filter specific file types (e.g., "*.ts"). Supports case-insensitive search. Great for finding code patterns, function definitions, or specific text across multiple files.',
        inputSchema: GrepContentInputSchema,
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
            };
        },
    };
}
