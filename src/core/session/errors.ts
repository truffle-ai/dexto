import { DextoError } from '@core/error/DextoError.js';
import { ErrorScope, ErrorType } from '@core/error/types.js';
import { SessionErrorCode } from './error-codes.js';

/**
 * Session error factory with typed methods for creating session-specific errors
 * Each method creates a properly typed DextoError with SESSION scope
 */
export class SessionError {
    /**
     * Session not found
     */
    static notFound(sessionId: string) {
        return new DextoError(
            SessionErrorCode.SESSION_NOT_FOUND,
            ErrorScope.SESSION,
            ErrorType.NOT_FOUND,
            `Session '${sessionId}' not found`,
            { sessionId }
        );
    }

    /**
     * Session creation failed
     */
    static creationFailed(reason: string, sessionId?: string) {
        return new DextoError(
            SessionErrorCode.SESSION_CREATION_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to create session: ${reason}`,
            { reason, sessionId }
        );
    }

    /**
     * Session initialization failed
     */
    static initializationFailed(sessionId: string, reason: string) {
        return new DextoError(
            SessionErrorCode.SESSION_INITIALIZATION_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to initialize session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    /**
     * Session cleanup failed
     */
    static cleanupFailed(sessionId: string, reason: string) {
        return new DextoError(
            SessionErrorCode.SESSION_CLEANUP_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to cleanup session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    /**
     * Session in invalid state
     */
    static invalidState(sessionId: string, currentState: string, expectedState?: string) {
        return new DextoError(
            SessionErrorCode.SESSION_INVALID_STATE,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Session '${sessionId}' is in invalid state: ${currentState}${expectedState ? `, expected: ${expectedState}` : ''}`,
            { sessionId, currentState, expectedState }
        );
    }

    /**
     * Session has expired
     */
    static expired(sessionId: string, expiredAt: Date) {
        return new DextoError(
            SessionErrorCode.SESSION_EXPIRED,
            ErrorScope.SESSION,
            ErrorType.NOT_FOUND,
            `Session '${sessionId}' expired at ${expiredAt.toISOString()}`,
            { sessionId, expiredAt: expiredAt.toISOString() }
        );
    }

    /**
     * Maximum number of sessions exceeded
     */
    static maxSessionsExceeded(currentCount: number, maxSessions: number) {
        return new DextoError(
            SessionErrorCode.SESSION_MAX_SESSIONS_EXCEEDED,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Cannot create session: maximum sessions limit reached (${currentCount}/${maxSessions})`,
            { currentCount, maxSessions },
            'Delete unused sessions or increase maxSessions limit in configuration'
        );
    }

    /**
     * Session storage failed
     */
    static storageFailed(sessionId: string, operation: string, reason: string) {
        return new DextoError(
            SessionErrorCode.SESSION_STORAGE_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to ${operation} session '${sessionId}': ${reason}`,
            { sessionId, operation, reason }
        );
    }

    /**
     * Session restoration failed
     */
    static restorationFailed(reason: string, sessionCount?: number) {
        return new DextoError(
            SessionErrorCode.SESSION_RESTORATION_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to restore sessions from storage: ${reason}`,
            { reason, sessionCount }
        );
    }

    /**
     * Session metadata save failed
     */
    static metadataSaveFailed(sessionId: string, reason: string) {
        return new DextoError(
            SessionErrorCode.SESSION_METADATA_SAVE_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to save metadata for session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    /**
     * Session reset failed
     */
    static resetFailed(sessionId: string, reason: string) {
        return new DextoError(
            SessionErrorCode.SESSION_RESET_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to reset session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }
}
