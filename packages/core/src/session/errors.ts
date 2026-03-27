import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
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
            'session',
            'not_found',
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
            'session',
            'system',
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
            'session',
            'user',
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
            'session',
            'system',
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
            'session',
            'system',
            `Failed to reset session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }
}
