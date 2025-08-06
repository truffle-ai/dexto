/**
 * Session-specific error codes
 * Includes session lifecycle, management, and state errors
 */
export const enum SessionErrorCode {
    // Session lifecycle
    SESSION_NOT_FOUND = 'session_not_found',
    SESSION_CREATION_FAILED = 'session_creation_failed',
    SESSION_INITIALIZATION_FAILED = 'session_initialization_failed',
    SESSION_CLEANUP_FAILED = 'session_cleanup_failed',

    // Session state and management
    SESSION_INVALID_STATE = 'session_invalid_state',
    SESSION_EXPIRED = 'session_expired',
    SESSION_MAX_SESSIONS_EXCEEDED = 'session_max_sessions_exceeded',

    // Session storage
    SESSION_STORAGE_FAILED = 'session_storage_failed',
    SESSION_RESTORATION_FAILED = 'session_restoration_failed',
    SESSION_METADATA_SAVE_FAILED = 'session_metadata_save_failed',

    // Session operations
    SESSION_RESET_FAILED = 'session_reset_failed',
}
