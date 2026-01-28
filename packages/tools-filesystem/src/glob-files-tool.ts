/**
 * Glob Files Tool
 *
 * Internal tool for finding files using glob patterns
 */

import * as path from 'node:path';
import { z } from 'zod';
import { InternalTool, ToolExecutionContext, ApprovalType } from '@dexto/core';
import type { SearchDisplayData, ApprovalRequestDetails, ApprovalResponse } from '@dexto/core';
import type { FileToolOptions } from './file-tool-types.js';

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
 * Create the glob_files internal tool with directory approval support
 */
export function createGlobFilesTool(options: FileToolOptions): InternalTool {
    const { fileSystemService, directoryApproval } = options;

    // Store search directory for use in onApprovalGranted callback
    let pendingApprovalSearchDir: string | undefined;

    return {
        id: 'glob_files',
        description:
            'Find files matching a glob pattern. Supports standard glob syntax like **/*.js for recursive matches, *.ts for files in current directory, and src/**/*.tsx for nested paths. Returns array of file paths with metadata (size, modified date). Results are limited to allowed paths only.',
        inputSchema: GlobFilesInputSchema,

        /**
         * Check if this glob operation needs directory access approval.
         * Returns custom approval request if the search directory is outside allowed paths.
         */
        getApprovalOverride: async (args: unknown): Promise<ApprovalRequestDetails | null> => {
            const { path: searchPath } = args as GlobFilesInput;

            // Resolve the search directory using the same base the service uses
            // This ensures approval decisions align with actual execution context
            const baseDir = fileSystemService.getWorkingDirectory();
            const searchDir = path.resolve(baseDir, searchPath || '.');

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
                    toolName: 'glob_files',
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
