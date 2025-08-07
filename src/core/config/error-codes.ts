/**
 * Config-specific error codes
 * Includes file operations, parsing, and validation errors for configuration management
 */
export const enum ConfigErrorCode {
    // File operations
    FILE_NOT_FOUND = 'config_file_not_found',
    FILE_READ_ERROR = 'config_file_read_error',
    FILE_WRITE_ERROR = 'config_file_write_error',

    // Parsing errors
    PARSE_ERROR = 'config_parse_error',
}
