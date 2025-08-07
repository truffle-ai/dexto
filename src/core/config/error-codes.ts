/**
 * Config-specific error codes
 * Includes file operations, parsing, and validation errors for configuration management
 */
export const enum ConfigErrorCode {
    // File operations
    FILE_NOT_FOUND = 'config_file_not_found',
    FILE_READ_ERROR = 'config_file_read_error',
    FILE_WRITE_ERROR = 'config_file_write_error',
    FILE_ACCESS_DENIED = 'config_file_access_denied',

    // Parsing errors
    PARSE_ERROR = 'config_parse_error',
    YAML_INVALID = 'config_yaml_invalid',

    // Validation errors
    VALIDATION_ERROR = 'config_validation_error',
    SCHEMA_INVALID = 'config_schema_invalid',

    // Path resolution
    PATH_INVALID = 'config_path_invalid',
    PATH_NOT_RESOLVED = 'config_path_not_resolved',
}
