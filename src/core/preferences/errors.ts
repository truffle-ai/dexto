// src/core/preferences/errors.ts

import { DextoRuntimeError, DextoValidationError } from '@core/errors/index.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { type ZodError } from 'zod';

export enum PreferenceErrorCode {
    FILE_NOT_FOUND = 'preference_file_not_found',
    FILE_READ_ERROR = 'preference_file_read_error',
    FILE_WRITE_ERROR = 'preference_file_write_error',
    VALIDATION_ERROR = 'preference_validation_error',
}

export class PreferenceError {
    static fileNotFound(preferencesPath: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_NOT_FOUND,
            ErrorScope.PREFERENCE,
            ErrorType.USER,
            `Preferences file not found: ${preferencesPath}`,
            { preferencesPath },
            'Run `dexto setup` to create preferences'
        );
    }

    static fileReadError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_READ_ERROR,
            ErrorScope.PREFERENCE,
            ErrorType.SYSTEM,
            `Failed to read preferences: ${cause}`,
            { preferencesPath, cause },
            'Check file permissions and ensure the file is not corrupted'
        );
    }

    static fileWriteError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_WRITE_ERROR,
            ErrorScope.PREFERENCE,
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
            severity: 'error' as const,
        }));

        return new DextoValidationError(issues);
    }
}
