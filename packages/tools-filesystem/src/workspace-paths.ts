import path from 'node:path';
import { DextoRuntimeError } from '@dexto/core/errors';
import { WorkspaceErrorCodes } from '@dexto/core/workspace';
import { ToolError } from '@dexto/core/tools';

export function toWorkspaceRelativePath(
    toolName: string,
    workspaceRoot: string,
    filePath: string
): string {
    if (!path.isAbsolute(filePath)) {
        assertRelativePath(toolName, filePath);
        return filePath.split(path.sep).join('/');
    }

    const relativePath = path.relative(workspaceRoot, filePath);
    if (relativePath === '') {
        return '.';
    }
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw ToolError.validationFailed(
            toolName,
            `Path must be inside the active workspace: ${filePath}`,
            { file_path: filePath, workspaceRoot }
        );
    }
    return relativePath.split(path.sep).join('/');
}

export function isWorkspaceFileNotFound(error: unknown): boolean {
    return error instanceof DextoRuntimeError && error.code === WorkspaceErrorCodes.FILE_NOT_FOUND;
}

export function assertWorkspaceRelativeGlob(toolName: string, pattern: string): void {
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
        throw ToolError.validationFailed(
            toolName,
            `Glob pattern must stay inside the active workspace: ${pattern}`,
            { pattern }
        );
    }
}

function assertRelativePath(toolName: string, filePath: string): void {
    if (filePath.split(/[\\/]/).includes('..')) {
        throw ToolError.validationFailed(
            toolName,
            `Path must stay inside the active workspace: ${filePath}`,
            { file_path: filePath }
        );
    }
}
