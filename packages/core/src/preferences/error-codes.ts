// packages/core/src/preferences/error-codes.ts

export enum PreferenceErrorCode {
    FILE_NOT_FOUND = 'preference_file_not_found',
    FILE_READ_ERROR = 'preference_file_read_error',
    FILE_WRITE_ERROR = 'preference_file_write_error',
    VALIDATION_ERROR = 'preference_validation_error',
    MODEL_INCOMPATIBLE = 'preference_model_incompatible',
    MISSING_BASE_URL = 'preference_missing_base_url',
}
