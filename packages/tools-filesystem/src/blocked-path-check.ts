import path from 'node:path';
import type { Logger } from '@dexto/core/logger';
import { FileSystemError } from './errors.js';
import { PathValidator } from './path-validator.js';
import type { FileSystemConfig } from './types.js';

/**
 * Returns the reason a workspace path is blocked by the configured blocked paths and blocked
 * extensions, or null when it is not blocked. Relative blocked paths resolve against the
 * workspace root.
 */
export type BlockedPathCheck = (
    workspaceRoot: string,
    workspacePath: string,
    logger: Logger
) => Promise<string | null>;

export function createBlockedPathCheck(config: FileSystemConfig): BlockedPathCheck {
    const validators = new Map<string, PathValidator>();
    return async (workspaceRoot, workspacePath, logger) => {
        let validator = validators.get(workspaceRoot);
        if (validator === undefined) {
            validator = new PathValidator({ ...config, workingDirectory: workspaceRoot }, logger);
            validators.set(workspaceRoot, validator);
        }
        const validation = await validator.validatePathForPreview(
            path.resolve(workspaceRoot, workspacePath)
        );
        return validation.isValid ? null : (validation.error ?? 'Path is not allowed');
    };
}

export async function assertPathNotBlocked(
    check: BlockedPathCheck,
    workspaceRoot: string,
    workspacePath: string,
    logger: Logger
): Promise<void> {
    const reason = await check(workspaceRoot, workspacePath, logger);
    if (reason !== null) {
        throw FileSystemError.invalidPath(workspacePath, reason);
    }
}
