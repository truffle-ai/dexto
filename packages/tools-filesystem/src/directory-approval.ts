import * as path from 'node:path';
import type { z, ZodTypeAny } from 'zod';
import { ToolError } from '@dexto/core/tools';
import type { ToolExecutionContext } from '@dexto/core/tools';
import type { FileSystemService } from './filesystem-service.js';
import type { FileSystemServiceGetter } from './file-tool-types.js';
import { resolveUserPath } from './path-utils.js';

type DirectoryApprovalOperation = 'read' | 'write' | 'edit';

type DirectoryApprovalPaths = {
    path: string;
    parentDir: string;
};

const DIRECTORY_APPROVAL_KEY_PREFIX = 'directory:';
const DIRECTORY_APPROVAL_OPERATION_SEPARATOR = ':operation:';

export function createDirectoryApprovalKey(
    directoryPath: string,
    operation?: DirectoryApprovalOperation
): string {
    const directoryKey = `${DIRECTORY_APPROVAL_KEY_PREFIX}${path.resolve(directoryPath)}`;
    return operation === undefined
        ? directoryKey
        : `${directoryKey}${DIRECTORY_APPROVAL_OPERATION_SEPARATOR}${operation}`;
}

export function isPathApprovedByDirectoryKey(
    filePath: string,
    approvedKeys: ReadonlyMap<string, 'session' | 'once'>,
    approvedTypes: ReadonlySet<'session' | 'once'> = new Set(['session', 'once']),
    operation?: DirectoryApprovalOperation
): boolean {
    const resolvedFilePath = path.resolve(filePath);
    for (const [key, type] of approvedKeys) {
        if (!key.startsWith(DIRECTORY_APPROVAL_KEY_PREFIX)) {
            continue;
        }
        if (!approvedTypes.has(type)) {
            continue;
        }

        const keyParts = key
            .slice(DIRECTORY_APPROVAL_KEY_PREFIX.length)
            .split(DIRECTORY_APPROVAL_OPERATION_SEPARATOR);
        const approvedDir = keyParts[0];
        const approvedOperation = keyParts[1];
        if (approvedDir === undefined) {
            continue;
        }
        if (approvedOperation !== undefined && approvedOperation !== operation) {
            continue;
        }
        const relative = path.relative(approvedDir, resolvedFilePath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
            return true;
        }
    }

    return false;
}

export function resolveFilePath(
    workingDirectory: string,
    filePath: string
): DirectoryApprovalPaths {
    const resolvedPath = resolveUserPath(workingDirectory, filePath);
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
    needsApproval: (
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ) => Promise<string | false>;
} {
    return {
        async needsApproval(
            input: z.output<TSchema>,
            context: ToolExecutionContext
        ): Promise<string | false> {
            const resolvedFileSystemService = await options.getFileSystemService(context);
            const paths = options.resolvePaths(input, resolvedFileSystemService);

            const isAllowed = await resolvedFileSystemService.isPathWithinConfigAllowed(paths.path);
            if (isAllowed) {
                return false;
            }

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    `${options.toolName} requires ToolExecutionContext.services.approval`
                );
            }

            const approvalKey = createDirectoryApprovalKey(paths.parentDir, options.operation);
            return isPathApprovedByDirectoryKey(
                paths.path,
                approvalManager.getApprovedKeys(context.sessionId),
                new Set(['session']),
                options.operation
            )
                ? false
                : approvalKey;
        },
    };
}
