/**
 * VCS error factory with typed methods for creating git-related errors
 * Each method creates a properly typed error with VCS scope
 */

import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { VCErrorCode } from './error-codes.js';

/**
 * VCS error factory for creating git-related errors
 */
export class VCSError {
    /**
     * Git executable not available
     */
    static gitNotAvailable(): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.GIT_NOT_AVAILABLE,
            ErrorScope.VCS,
            ErrorType.SYSTEM,
            'Git executable is not available. Please install git.',
            undefined,
            'Install git from https://git-scm.com or your package manager'
        );
    }

    /**
     * Current directory is not a git repository
     */
    static notGitRepo(path: string): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.NOT_GIT_REPO,
            ErrorScope.VCS,
            ErrorType.USER,
            `Not a git repository: ${path}`,
            { path }
        );
    }

    /**
     * Worktree already exists
     */
    static worktreeExists(name: string, path: string): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.WORKTREE_EXISTS,
            ErrorScope.VCS,
            ErrorType.CONFLICT,
            `Worktree '${name}' already exists at ${path}`,
            { name, path }
        );
    }

    /**
     * Worktree not found
     */
    static worktreeNotFound(name: string): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.WORKTREE_NOT_FOUND,
            ErrorScope.VCS,
            ErrorType.NOT_FOUND,
            `Worktree '${name}' not found`,
            { name }
        );
    }

    /**
     * Invalid worktree name (path traversal or invalid characters)
     */
    static invalidWorktreeName(name: string): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.INVALID_WORKTREE_NAME,
            ErrorScope.VCS,
            ErrorType.USER,
            `Invalid worktree name '${name}'. Use only letters, numbers, dots, dashes, and underscores.`,
            { name }
        );
    }

    /**
     * Worktree creation failed
     */
    static worktreeCreateFailed(
        name: string,
        reason: string,
        details?: Record<string, unknown>
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.WORKTREE_CREATE_FAILED,
            ErrorScope.VCS,
            ErrorType.SYSTEM,
            `Failed to create worktree '${name}': ${reason}`,
            { name, reason, ...details }
        );
    }

    /**
     * Generic worktree operation failed
     */
    static worktreeOperationFailed(
        operation: string,
        reason: string,
        details?: Record<string, unknown>
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.WORKTREE_OPERATION_FAILED,
            ErrorScope.VCS,
            ErrorType.SYSTEM,
            `Worktree operation '${operation}' failed: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Git command execution failed
     */
    static gitCommandFailed(
        command: string,
        reason: string,
        details?: Record<string, unknown>
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.GIT_COMMAND_FAILED,
            ErrorScope.VCS,
            ErrorType.SYSTEM,
            `Git command '${command}' failed: ${reason}`,
            { command, reason, ...details }
        );
    }

    /**
     * Git branch operation failed
     */
    static gitBranchFailed(operation: string, name: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            VCErrorCode.GIT_BRANCH_FAILED,
            ErrorScope.VCS,
            ErrorType.SYSTEM,
            `Git branch ${operation} '${name}' failed: ${reason}`,
            { operation, name, reason }
        );
    }
}
