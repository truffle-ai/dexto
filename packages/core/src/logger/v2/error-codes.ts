/**
 * Logger-specific error codes
 * Covers transport initialization, configuration, and logging operations
 */

export const LOGGER_ERROR_CODES = [
    'logger_transport_not_implemented',
    'logger_transport_unknown_type',
    'logger_transport_initialization_failed',
    'logger_transport_write_failed',
    'logger_invalid_config',
    'logger_invalid_log_level',
] as const;

export type LoggerErrorCode = (typeof LOGGER_ERROR_CODES)[number];

const LoggerErrorCodeValues = {
    // Transport errors
    TRANSPORT_NOT_IMPLEMENTED: 'logger_transport_not_implemented',
    TRANSPORT_UNKNOWN_TYPE: 'logger_transport_unknown_type',
    TRANSPORT_INITIALIZATION_FAILED: 'logger_transport_initialization_failed',
    TRANSPORT_WRITE_FAILED: 'logger_transport_write_failed',

    // Configuration errors
    INVALID_CONFIG: 'logger_invalid_config',
    INVALID_LOG_LEVEL: 'logger_invalid_log_level',
} as const satisfies Record<string, LoggerErrorCode>;

export { LoggerErrorCodeValues as LoggerErrorCode };
