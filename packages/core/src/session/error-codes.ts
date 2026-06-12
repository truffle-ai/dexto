/**
 * Session-specific error codes
 * Includes session lifecycle, management, and state errors
 */

export const SESSION_ERROR_CODES = [
    'session_not_found',
    'session_initialization_failed',
    'session_max_sessions_exceeded',
    'session_storage_failed',
    'session_reset_failed',
    'session_busy',
] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const SessionErrorCode = {
    // Session lifecycle
    SESSION_NOT_FOUND: 'session_not_found',
    SESSION_INITIALIZATION_FAILED: 'session_initialization_failed',
    SESSION_MAX_SESSIONS_EXCEEDED: 'session_max_sessions_exceeded',

    // Session storage
    SESSION_STORAGE_FAILED: 'session_storage_failed',

    // Session operations
    SESSION_RESET_FAILED: 'session_reset_failed',
    SESSION_BUSY: 'session_busy',
} as const;
