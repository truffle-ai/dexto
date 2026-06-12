// packages/agent-management/src/preferences/error-codes.ts

export const PREFERENCE_ERROR_CODES = [
    'preference_file_not_found',
    'preference_file_read_error',
    'preference_file_write_error',
    'preference_validation_error',
    'preference_model_incompatible',
    'preference_invalid_value',
    'preference_missing_required',
] as const;

export type PreferenceErrorCode = (typeof PREFERENCE_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const PreferenceErrorCode = {
    FILE_NOT_FOUND: 'preference_file_not_found',
    FILE_READ_ERROR: 'preference_file_read_error',
    FILE_WRITE_ERROR: 'preference_file_write_error',
    VALIDATION_ERROR: 'preference_validation_error',
    MODEL_INCOMPATIBLE: 'preference_model_incompatible',
    INVALID_PREFERENCE_VALUE: 'preference_invalid_value',
    MISSING_PREFERENCE: 'preference_missing_required',
} as const;
