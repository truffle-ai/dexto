import * as path from 'node:path';
import { ToolError } from '@dexto/core';
import type { ToolExecutionContext } from '@dexto/core';
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

export function createDirectoryAccessApprovalHandlers<TInput>(options: {
    toolName: string;
    operation: DirectoryApprovalOperation;
    getFileSystemService: FileSystemServiceGetter;
    resolvePaths: (input: TInput, fileSystemService: FileSystemService) => DirectoryApprovalPaths;
}): {
    getDirectoryAccessMetadata: (
        input: TInput,
        context: ToolExecutionContext
    ) => Promise<{
        path: string;
        parentDir: string;
        operation: DirectoryApprovalOperation;
        toolName: string;
    } | null>;
} {
    return {
        async getDirectoryAccessMetadata(input, context) {
            const resolvedFileSystemService = await options.getFileSystemService(context);
            const paths = options.resolvePaths(input, resolvedFileSystemService);

            // Check if path is within config-allowed paths
            const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(paths.path);
            if (isAllowed) {
                return null;
            }

            // Check if directory is already session-approved (prompting decision)
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
                path: paths.path,
                parentDir: paths.parentDir,
                operation: options.operation,
                toolName: options.toolName,
            };
        },
    };
}
