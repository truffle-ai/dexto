import { ApprovalType, ToolError } from '@dexto/core';
import type { ApprovalRequestDetails, ApprovalResponse, ToolExecutionContext } from '@dexto/core';
import type { FileSystemService } from './filesystem-service.js';
import type { FileSystemServiceGetter } from './file-tool-types.js';

type DirectoryApprovalOperation = 'read' | 'write' | 'edit';

type DirectoryApprovalPaths = {
    path: string;
    parentDir: string;
};

export function createDirectoryAccessApprovalHandlers<TInput>(options: {
    toolName: string;
    operation: DirectoryApprovalOperation;
    getFileSystemService: FileSystemServiceGetter;
    resolvePaths: (input: TInput, fileSystemService: FileSystemService) => DirectoryApprovalPaths;
}): {
    getApprovalOverride: (
        input: TInput,
        context: ToolExecutionContext
    ) => Promise<ApprovalRequestDetails | null>;
    onApprovalGranted: (
        response: ApprovalResponse,
        context: ToolExecutionContext,
        approvalRequest: ApprovalRequestDetails
    ) => void;
} {
    return {
        async getApprovalOverride(input, context): Promise<ApprovalRequestDetails | null> {
            const resolvedFileSystemService = await options.getFileSystemService(context);
            const paths = options.resolvePaths(input, resolvedFileSystemService);

            // Check if path is within config-allowed paths
            const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(paths.path);
            if (isAllowed) {
                return null; // Use normal tool confirmation
            }

            // Check if directory is already session-approved (prompting decision)
            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    `${options.toolName} requires ToolExecutionContext.services.approval`
                );
            }
            if (approvalManager.isDirectorySessionApproved(paths.path)) {
                return null; // Already approved, use normal flow
            }

            // Need directory access approval
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
            const data = response.data as { rememberDirectory?: boolean } | undefined;
            const rememberDirectory = data?.rememberDirectory ?? false;

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    `${options.toolName} requires ToolExecutionContext.services.approval`
                );
            }
            approvalManager.addApprovedDirectory(parentDir, rememberDirectory ? 'session' : 'once');
        },
    };
}
