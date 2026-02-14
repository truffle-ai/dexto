import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
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
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_NOT_FOUND,
            ErrorScope.SESSION,
            ErrorType.NOT_FOUND,
            `Session ${sessionId} not found`,
            { sessionId }
        );
    }

    /**
     * Session initialization failed
     */
    static initializationFailed(sessionId: string, reason: string) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_INITIALIZATION_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to initialize session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    /**
     * Maximum number of sessions exceeded
     */
    static maxSessionsExceeded(currentCount: number, maxSessions: number) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_MAX_SESSIONS_EXCEEDED,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Maximum sessions (${maxSessions}) reached`,
            { currentCount, maxSessions },
            'Delete unused sessions or increase maxSessions limit in configuration'
        );
    }

    /**
     * Session storage failed
     */
    static storageFailed(sessionId: string, operation: string, reason: string) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_STORAGE_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to ${operation} session '${sessionId}': ${reason}`,
            { sessionId, operation, reason }
        );
    }

    /**
     * Session reset failed
     */
    static resetFailed(sessionId: string, reason: string) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_RESET_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to reset session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }
}
