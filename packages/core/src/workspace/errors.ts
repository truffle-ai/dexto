import { DextoValidationError } from '../errors/DextoValidationError.js';
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
}
