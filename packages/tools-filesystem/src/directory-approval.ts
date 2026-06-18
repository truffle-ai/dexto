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

export function createDirectoryApprovalKey(directoryPath: string): string {
    return `${DIRECTORY_APPROVAL_KEY_PREFIX}${path.resolve(directoryPath)}`;
}

export function isPathApprovedByDirectoryKey(
    filePath: string,
    approvedKeys: ReadonlyMap<string, 'session' | 'once'>,
    approvedTypes: ReadonlySet<'session' | 'once'> = new Set(['session', 'once'])
): boolean {
    const resolvedFilePath = path.resolve(filePath);
    for (const [key, type] of approvedKeys) {
        if (!key.startsWith(DIRECTORY_APPROVAL_KEY_PREFIX)) {
            continue;
        }
        if (!approvedTypes.has(type)) {
            continue;
        }

        const approvedDir = key.slice(DIRECTORY_APPROVAL_KEY_PREFIX.length);
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

            const approvalKey = createDirectoryApprovalKey(paths.parentDir);
            return isPathApprovedByDirectoryKey(
                paths.path,
                approvalManager.getApprovedKeys(context.sessionId),
                new Set(['session'])
            )
                ? false
                : approvalKey;
        },
    };
}
