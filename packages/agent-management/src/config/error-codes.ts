/**
 * Config-specific error codes
 * Includes file operations, parsing, and validation errors for configuration management
 */

export const CONFIG_ERROR_CODES = [
    'config_file_not_found',
    'config_file_read_error',
    'config_file_write_error',
    'config_parse_error',
    'config_no_project_default',
    'config_invalid_project_primary',
    'config_no_global_preferences',
    'config_setup_incomplete',
    'config_bundled_not_found',
    'config_unknown_context',
] as const;

export type ConfigErrorCode = (typeof CONFIG_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ConfigErrorCode = {
    // File operations
    FILE_NOT_FOUND: 'config_file_not_found',
    FILE_READ_ERROR: 'config_file_read_error',
    FILE_WRITE_ERROR: 'config_file_write_error',

    // Parsing errors
    PARSE_ERROR: 'config_parse_error',

    // Resolution errors
    NO_PROJECT_DEFAULT: 'config_no_project_default',
    INVALID_PROJECT_PRIMARY: 'config_invalid_project_primary',
    NO_GLOBAL_PREFERENCES: 'config_no_global_preferences',
    SETUP_INCOMPLETE: 'config_setup_incomplete',
    BUNDLED_NOT_FOUND: 'config_bundled_not_found',
    UNKNOWN_CONTEXT: 'config_unknown_context',
} as const;
