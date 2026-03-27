import { DextoValidationError } from '../errors/DextoValidationError.js';
import { WorkspaceErrorCodes } from './error-codes.js';

export class WorkspaceError {
    static pathRequired(): DextoValidationError {
        return new DextoValidationError([
            {
                code: WorkspaceErrorCodes.PATH_REQUIRED,
                message: 'Workspace path is required',
                scope: 'workspace',
                type: 'user',
                severity: 'error',
                path: ['path'],
            },
        ]);
    }
}
