import { DextoValidationError } from '../errors/DextoValidationError.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorType } from '../errors/types.js';
import { WorkspaceErrorCodes } from './error-codes.js';

export class WorkspaceError {
    static pathRequired(): DextoValidationError {
        return new DextoValidationError([
            {
                code: WorkspaceErrorCodes.PATH_REQUIRED,
                message: 'Workspace path is required',
                scope: 'workspace',
                type: ErrorType.USER,
                severity: 'error',
                path: ['path'],
            },
        ]);
    }

    static currentWorkspaceRequired(): DextoValidationError {
        return new DextoValidationError([
            {
                code: WorkspaceErrorCodes.CURRENT_WORKSPACE_REQUIRED,
                message: 'Current workspace is required',
                scope: 'workspace',
                type: ErrorType.USER,
                severity: 'error',
                path: ['currentWorkspace'],
            },
        ]);
    }

    static handleProviderRequired(): DextoValidationError {
        return new DextoValidationError([
            {
                code: WorkspaceErrorCodes.HANDLE_PROVIDER_REQUIRED,
                message: 'Workspace handle provider is required',
                scope: 'workspace',
                type: ErrorType.SYSTEM,
                severity: 'error',
                path: ['handleProvider'],
            },
        ]);
    }

    static fileNotFound(path: string): DextoRuntimeError<{ path: string }> {
        return new DextoRuntimeError(
            WorkspaceErrorCodes.FILE_NOT_FOUND,
            'workspace',
            ErrorType.NOT_FOUND,
            `Workspace file not found: ${path}`,
            { path }
        );
    }

    static pathOutsideWorkspace(path: string): DextoRuntimeError<{ path: string }> {
        return new DextoRuntimeError(
            WorkspaceErrorCodes.PATH_OUTSIDE_WORKSPACE,
            'workspace',
            ErrorType.FORBIDDEN,
            `Workspace path escapes root: ${path}`,
            { path }
        );
    }
}
