import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
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
     * Maximum sub-agent depth exceeded
     */
    static maxDepthExceeded(depth: number, maxDepth: number) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_MAX_DEPTH_EXCEEDED,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Sub-agent nesting depth (${depth}) exceeds maximum allowed depth (${maxDepth})`,
            { depth, maxDepth },
            'Reduce sub-agent nesting or increase maxSubAgentDepth limit in configuration'
        );
    }

    /**
     * Invalid scope value
     */
    static invalidScope(field: string, value: any, reason: string) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_INVALID_SCOPE,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Invalid scope value for '${field}': ${reason}`,
            { field, value, reason },
            'Provide a valid scope value'
        );
    }

    /**
     * Parent session not found
     */
    static parentNotFound(parentSessionId: string) {
        return new DextoRuntimeError(
            SessionErrorCode.SESSION_PARENT_NOT_FOUND,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Parent session '${parentSessionId}' not found`,
            { parentSessionId },
            'Create the parent session first or remove parentSessionId from scopes'
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
