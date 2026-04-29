/**
 * Grep Content Tool
 *
 * Internal tool for searching file contents using regex patterns
 */

import { z } from 'zod';
import safeRegex from 'safe-regex';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core/tools';
import type { SearchDisplayData, Tool, ToolExecutionContext } from '@dexto/core/tools';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { createDirectoryAccessApprovalHandlers } from './directory-approval.js';
import { resolveUserPath } from './path-utils.js';
import { FileSystemError } from './errors.js';
import {
    assertWorkspaceRelativeGlob,
    isWorkspaceFileNotFound,
    toWorkspaceRelativePath,
} from './workspace-paths.js';

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
                const searchDir = resolveUserPath(baseDir, input.path || '.');
                return { path: searchDir, parentDir: searchDir };
            },
        }),

        async execute(input, context: ToolExecutionContext) {
            const {
                pattern,
                path: searchPath,
                glob,
                context_lines,
                case_insensitive,
                max_results,
            } = input;
            if (!context.services) {
                throw new Error('grep_content requires ToolExecutionContext.services');
            }
            if (!safeRegex(pattern)) {
                throw FileSystemError.invalidPattern(
                    pattern,
                    'Pattern may cause catastrophic backtracking (ReDoS). Please simplify the regex.'
                );
            }

            const handle = await context.services.workspaceManager.open({ intent: 'read' });
            const regex = createRegex(pattern, case_insensitive);
            const files = await findSearchFiles(
                handle.files,
                handle.context.path,
                searchPath,
                glob
            );
            const matches: Array<{
                file: string;
                lineNumber: number;
                line: string;
                context?: { before: string[]; after: string[] };
            }> = [];
            let filesSearched = 0;

            for (const file of files) {
                let content: string;
                try {
                    content = await handle.files.readText(file);
                } catch (error) {
                    context.logger.debug(
                        `Skipping file ${file}: ${error instanceof Error ? error.message : String(error)}`
                    );
                    continue;
                }

                filesSearched += 1;
                const lines = content.split('\n');

                for (let index = 0; index < lines.length; index += 1) {
                    const line = lines[index] ?? '';
                    regex.lastIndex = 0;
                    if (!regex.test(line)) continue;

                    const matchContext =
                        context_lines > 0 ? collectContext(lines, index, context_lines) : undefined;
                    matches.push({
                        file,
                        lineNumber: index + 1,
                        line,
                        ...(matchContext !== undefined && { context: matchContext }),
                    });

                    if (matches.length >= max_results) {
                        return formatSearchResult(pattern, matches, filesSearched, true);
                    }
                }
            }

            return formatSearchResult(pattern, matches, filesSearched, false);
        },
    });
}

function createRegex(pattern: string, caseInsensitive: boolean): RegExp {
    try {
        return new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch {
        throw FileSystemError.invalidPattern(pattern, 'Invalid regular expression syntax');
    }
}

async function findSearchFiles(
    files: { readText(path: string): Promise<string>; glob(pattern: string): Promise<string[]> },
    workspaceRoot: string,
    searchPath: string | undefined,
    globPattern: string | undefined
): Promise<string[]> {
    const workspacePath = toWorkspaceRelativePath('grep_content', workspaceRoot, searchPath || '.');
    if (searchPath && !globPattern) {
        try {
            await files.readText(workspacePath);
            return [workspacePath];
        } catch (error) {
            if (!isWorkspaceFileNotFound(error)) {
                throw error;
            }
            // Treat unreadable direct paths as directories and search below them.
        }
    }

    const pattern = globPattern ?? '**/*';
    assertWorkspaceRelativeGlob('grep_content', pattern);
    if (workspacePath === '.' || workspacePath === '') {
        return files.glob(pattern);
    }
    return files.glob(`${workspacePath.replace(/\/$/, '')}/${pattern}`);
}

function collectContext(
    lines: string[],
    matchIndex: number,
    contextLines: number
): { before: string[]; after: string[] } {
    return {
        before: lines.slice(Math.max(0, matchIndex - contextLines), matchIndex),
        after: lines.slice(matchIndex + 1, matchIndex + contextLines + 1),
    };
}

function formatSearchResult(
    pattern: string,
    matches: Array<{
        file: string;
        lineNumber: number;
        line: string;
        context?: { before: string[]; after: string[] };
    }>,
    filesSearched: number,
    truncated: boolean
) {
    const _display: SearchDisplayData = {
        type: 'search',
        pattern,
        matches: matches.map((match) => ({
            file: match.file,
            line: match.lineNumber,
            content: match.line,
            ...(match.context && {
                context: [...match.context.before, ...match.context.after],
            }),
        })),
        totalMatches: matches.length,
        truncated,
    };

    return {
        matches: matches.map((match) => ({
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
        total_matches: matches.length,
        files_searched: filesSearched,
        truncated,
        _display,
    };
}
