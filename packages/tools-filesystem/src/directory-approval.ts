import * as path from 'node:path';
import type { z, ZodTypeAny } from 'zod';
import { ApprovalStatus, ApprovalType, ToolError } from '@dexto/core';
import type { ApprovalRequestDetails, ApprovalResponse, ToolExecutionContext } from '@dexto/core';
import type { FileSystemService } from './filesystem-service.js';
import type { FileSystemServiceGetter } from './file-tool-types.js';

type DirectoryApprovalOperation = 'read' | 'write' | 'edit';

type DirectoryApprovalPaths = {
    path: string;
    parentDir: string;
};

export function resolveFilePath(
    workingDirectory: string,
    filePath: string
): DirectoryApprovalPaths {
    const resolvedPath = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(workingDirectory, filePath);
    return { path: resolvedPath, parentDir: path.dirname(resolvedPath) };
}

export function createDirectoryAccessApprovalHandlers<const TSchema extends ZodTypeAny>(options: {
    toolName: string;
    operation: DirectoryApprovalOperation;
    inputSchema: TSchema;
    getFileSystemService: FileSystemServiceGetter;
    resolvePaths: (
        input: z.output<TSchema>,
        fileSystemService: FileSystemService
    ) => DirectoryApprovalPaths;
}): {
    approval: {
        override: (
            input: z.output<TSchema>,
            context: ToolExecutionContext
        ) => Promise<ApprovalRequestDetails | null>;
        onGranted: (
            response: ApprovalResponse,
            context: ToolExecutionContext,
            approvalRequest: ApprovalRequestDetails
        ) => Promise<void>;
    };
} {
    return {
        approval: {
            async override(input, context) {
                const resolvedFileSystemService = await options.getFileSystemService(context);
                const paths = options.resolvePaths(input, resolvedFileSystemService);

                const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(
                    paths.path
                );
                if (isAllowed) {
                    return null;
                }

                const approvalManager = context.services?.approval;
                if (!approvalManager) {
                    throw ToolError.configInvalid(
                        `${options.toolName} requires ToolExecutionContext.services.approval`
                    );
                }
                if (approvalManager.isDirectorySessionApproved(paths.path)) {
                    return null;
                }

                return {
                    type: ApprovalType.DIRECTORY_ACCESS,
                    metadata: {
                        path: paths.path,
                        parentDir: paths.parentDir,
                        operation: options.operation,
                        toolName: options.toolName,
                    },
                };
            },

            async onGranted(response, context, approvalRequest) {
                const approvalManager = context.services?.approval;
                if (!approvalManager) {
                    return;
                }

                if (response.status !== ApprovalStatus.APPROVED) {
                    return;
                }

                const data = response.data as { rememberDirectory?: boolean } | undefined;
                const rememberDirectory = data?.rememberDirectory ?? false;

                const metadata = approvalRequest.metadata as { parentDir: string };
                if (!metadata?.parentDir) {
                    return;
                }

                approvalManager.addApprovedDirectory(
                    metadata.parentDir,
                    rememberDirectory ? 'session' : 'once'
                );
            },
        },
    };
}
