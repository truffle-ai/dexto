/**
 * Read File Tool
 *
 * Internal tool for reading file contents with size limits and pagination
 */

import * as path from 'node:path';
import { z } from 'zod';
import { ApprovalType, ToolError, defineTool } from '@dexto/core';
import type { FileDisplayData, ApprovalRequestDetails, ApprovalResponse } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { FileSystemServiceGetter } from './file-tool-types.js';

const ReadFileInputSchema = z
    .object({
        file_path: z.string().describe('Absolute path to the file to read'),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum number of lines to read (optional)'),
        offset: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Starting line number (1-based, optional)'),
    })
    .strict();

type ReadFileInput = z.input<typeof ReadFileInputSchema>;

/**
 * Create the read_file internal tool with directory approval support
 */
export function createReadFileTool(getFileSystemService: FileSystemServiceGetter): Tool {
    return defineTool({
        id: 'read_file',
        displayName: 'Read',
        aliases: ['read'],
        description:
            'Read the contents of a file with optional pagination. Returns file content, line count, encoding, and whether the output was truncated. Use limit and offset parameters for large files to read specific sections. This tool is for reading files within allowed paths only.',
        inputSchema: ReadFileInputSchema,

        /**
         * Check if this read operation needs directory access approval.
         * Returns custom approval request if the file is outside allowed paths.
         */
        async getApprovalOverride(
            input,
            context: ToolExecutionContext
        ): Promise<ApprovalRequestDetails | null> {
            const { file_path } = input;
            if (!file_path) return null;

            const resolvedFileSystemService = await getFileSystemService(context);

            // Check if path is within config-allowed paths (async for non-blocking symlink resolution)
            const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(file_path);
            if (isAllowed) {
                return null; // Use normal tool confirmation
            }

            // Check if directory is already session-approved (prompting decision)
            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'read_file requires ToolExecutionContext.services.approval'
                );
            }
            if (approvalManager.isDirectorySessionApproved(file_path)) {
                return null; // Already approved, use normal flow
            }

            // Need directory access approval
            const absolutePath = path.resolve(file_path);
            const parentDir = path.dirname(absolutePath);

            return {
                type: ApprovalType.DIRECTORY_ACCESS,
                metadata: {
                    path: absolutePath,
                    parentDir,
                    operation: 'read',
                    toolName: 'read_file',
                },
            };
        },

        /**
         * Handle approved directory access - remember the directory for session
         */
        onApprovalGranted(
            response: ApprovalResponse,
            context: ToolExecutionContext,
            approvalRequest: ApprovalRequestDetails
        ): void {
            if (approvalRequest.type !== ApprovalType.DIRECTORY_ACCESS) {
                return;
            }

            const metadata = approvalRequest.metadata as { parentDir?: unknown } | undefined;
            const parentDir = typeof metadata?.parentDir === 'string' ? metadata.parentDir : null;
            if (!parentDir) {
                return;
            }

            // Check if user wants to remember the directory
            // Use type assertion to access rememberDirectory since response.data is a union type
            const data = response.data as { rememberDirectory?: boolean } | undefined;
            const rememberDirectory = data?.rememberDirectory ?? false;

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'read_file requires ToolExecutionContext.services.approval'
                );
            }
            approvalManager.addApprovedDirectory(parentDir, rememberDirectory ? 'session' : 'once');
        },

        async execute(input, context: ToolExecutionContext) {
            const resolvedFileSystemService = await getFileSystemService(context);

            // Input is validated by provider before reaching here
            const { file_path, limit, offset } = input;

            // Read file using FileSystemService
            const result = await resolvedFileSystemService.readFile(file_path, {
                limit,
                offset,
            });

            // Build display data
            const _display: FileDisplayData = {
                type: 'file',
                path: file_path,
                operation: 'read',
                size: result.size,
                lineCount: result.lines,
            };

            return {
                content: result.content,
                lines: result.lines,
                encoding: result.encoding,
                truncated: result.truncated,
                size: result.size,
                ...(result.mimeType && { mimeType: result.mimeType }),
                _display,
            };
        },
    });
}
