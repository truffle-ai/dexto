// packages/agent-management/src/preferences/error-codes.ts

export const PreferenceErrorCode = {
    FILE_NOT_FOUND: 'preference_file_not_found',
    FILE_READ_ERROR: 'preference_file_read_error',
    FILE_WRITE_ERROR: 'preference_file_write_error',
    VALIDATION_ERROR: 'preference_validation_error',
    MODEL_INCOMPATIBLE: 'preference_model_incompatible',
    INVALID_PREFERENCE_VALUE: 'preference_invalid_value',
    MISSING_PREFERENCE: 'preference_missing_required',
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type PreferenceErrorCode = (typeof PreferenceErrorCode)[keyof typeof PreferenceErrorCode];

export const PREFERENCE_ERROR_CODES = Object.values(
    PreferenceErrorCode
) as readonly PreferenceErrorCode[];
