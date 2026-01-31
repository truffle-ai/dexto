// packages/core/src/preferences/errors.ts

import { DextoRuntimeError, DextoValidationError, ErrorType } from '@dexto/core';
import { type ZodError } from 'zod';
import { PreferenceErrorCode } from './error-codes.js';

export { PreferenceErrorCode } from './error-codes.js';

export class PreferenceError {
    static fileNotFound(preferencesPath: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_NOT_FOUND,
            'preference',
            ErrorType.USER,
            `Preferences file not found: ${preferencesPath}`,
            { preferencesPath },
            'Run `dexto setup` to create preferences'
        );
    }

    static fileReadError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_READ_ERROR,
            'preference',
            ErrorType.SYSTEM,
            `Failed to read preferences: ${cause}`,
            { preferencesPath, cause },
            'Check file permissions and ensure the file is not corrupted'
        );
    }

    static fileWriteError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_WRITE_ERROR,
            'preference',
            ErrorType.SYSTEM,
            `Failed to save preferences: ${cause}`,
            { preferencesPath, cause },
            'Check file permissions and available disk space'
        );
    }

    static validationFailed(zodError: ZodError) {
        const issues = zodError.issues.map((issue) => ({
            code: PreferenceErrorCode.VALIDATION_ERROR,
            message: `${issue.path.join('.')}: ${issue.message}`,
            scope: 'preference',
            type: ErrorType.USER,
            severity: 'error' as const,
        }));

        return new DextoValidationError(issues);
    }

    static invalidAgentId(agentId: string) {
        return new DextoValidationError([
            {
                code: PreferenceErrorCode.INVALID_PREFERENCE_VALUE,
                message: `agentId is invalid: ${agentId}`,
                scope: 'preference',
                type: ErrorType.USER,
                severity: 'error' as const,
            },
        ]);
    }
}
