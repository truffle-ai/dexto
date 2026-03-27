// packages/core/src/preferences/errors.ts

import { DextoRuntimeError, DextoValidationError } from '@dexto/core';
import type { Issue } from '@dexto/core';
import { type ZodError } from 'zod';
import { PreferenceErrorCode } from './error-codes.js';

export { PreferenceErrorCode } from './error-codes.js';

export class PreferenceError {
    static fileNotFound(preferencesPath: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_NOT_FOUND,
            'preference',
            'user',
            `Preferences file not found: ${preferencesPath}`,
            { preferencesPath },
            'Run `dexto setup` to create preferences'
        );
    }

    static fileReadError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_READ_ERROR,
            'preference',
            'system',
            `Failed to read preferences: ${cause}`,
            { preferencesPath, cause },
            'Check file permissions and ensure the file is not corrupted'
        );
    }

    static fileWriteError(preferencesPath: string, cause: string) {
        return new DextoRuntimeError(
            PreferenceErrorCode.FILE_WRITE_ERROR,
            'preference',
            'system',
            `Failed to save preferences: ${cause}`,
            { preferencesPath, cause },
            'Check file permissions and available disk space'
        );
    }

    static validationFailed(zodError: ZodError) {
        const issues: Issue[] = zodError.issues.map((issue) => ({
            code: PreferenceErrorCode.VALIDATION_ERROR,
            message: `${issue.path.join('.')}: ${issue.message}`,
            scope: 'preference',
            type: 'user',
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
                type: 'user',
                severity: 'error' as const,
            },
        ]);
    }
}
