/**
 * Config-specific error codes
 * Includes file operations, parsing, and validation errors for configuration management
 */
export enum ConfigErrorCode {
    // File operations
    FILE_NOT_FOUND = 'config_file_not_found',
    FILE_READ_ERROR = 'config_file_read_error',
    FILE_WRITE_ERROR = 'config_file_write_error',

    // Parsing errors
    PARSE_ERROR = 'config_parse_error',

    // Resolution errors
    NO_PROJECT_DEFAULT = 'config_no_project_default',
    NO_GLOBAL_PREFERENCES = 'config_no_global_preferences',
    SETUP_INCOMPLETE = 'config_setup_incomplete',
    BUNDLED_NOT_FOUND = 'config_bundled_not_found',
    UNKNOWN_CONTEXT = 'config_unknown_context',
}
