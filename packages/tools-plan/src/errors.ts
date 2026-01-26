/**
 * Plan Error Factory
 *
 * Provides typed errors for plan operations following the DextoRuntimeError pattern.
 */

import { DextoRuntimeError, ErrorType } from '@dexto/core';

/**
 * Error codes for plan operations
 */
export const PlanErrorCode = {
    /** Plan already exists for session */
    PLAN_ALREADY_EXISTS: 'PLAN_ALREADY_EXISTS',
    /** Plan not found for session */
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    /** Invalid plan content */
    INVALID_PLAN_CONTENT: 'INVALID_PLAN_CONTENT',
    /** Session ID required */
    SESSION_ID_REQUIRED: 'SESSION_ID_REQUIRED',
    /** Invalid session ID (path traversal attempt) */
    INVALID_SESSION_ID: 'INVALID_SESSION_ID',
    /** Checkpoint not found */
    CHECKPOINT_NOT_FOUND: 'CHECKPOINT_NOT_FOUND',
    /** Storage operation failed */
    STORAGE_ERROR: 'STORAGE_ERROR',
} as const;

export type PlanErrorCodeType = (typeof PlanErrorCode)[keyof typeof PlanErrorCode];

/**
 * Error factory for plan operations
 */
export const PlanError = {
    /**
     * Plan already exists for the given session
     */
    planAlreadyExists(sessionId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.PLAN_ALREADY_EXISTS,
            'plan',
            ErrorType.USER,
            `A plan already exists for session '${sessionId}'. Use plan_update to modify it.`,
            { sessionId },
            'Use plan_update to modify the existing plan, or plan_read to view it.'
        );
    },

    /**
     * Plan not found for the given session
     */
    planNotFound(sessionId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.PLAN_NOT_FOUND,
            'plan',
            ErrorType.NOT_FOUND,
            `No plan found for session '${sessionId}'.`,
            { sessionId },
            'Use plan_create to create a new plan for this session.'
        );
    },

    /**
     * Session ID is required for plan operations
     */
    sessionIdRequired(): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.SESSION_ID_REQUIRED,
            'plan',
            ErrorType.USER,
            'Session ID is required for plan operations.',
            {},
            'Ensure the tool is called within a valid session context.'
        );
    },

    /**
     * Invalid session ID (path traversal attempt)
     */
    invalidSessionId(sessionId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.INVALID_SESSION_ID,
            'plan',
            ErrorType.USER,
            `Invalid session ID: '${sessionId}' contains invalid path characters.`,
            { sessionId },
            'Session IDs must not contain path traversal characters like "..".'
        );
    },

    /**
     * Checkpoint not found in plan
     */
    checkpointNotFound(checkpointId: string, sessionId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.CHECKPOINT_NOT_FOUND,
            'plan',
            ErrorType.NOT_FOUND,
            `Checkpoint '${checkpointId}' not found in plan for session '${sessionId}'.`,
            { checkpointId, sessionId },
            'Use plan_read to view available checkpoints.'
        );
    },

    /**
     * Storage operation failed
     */
    storageError(operation: string, sessionId: string, cause?: Error): DextoRuntimeError {
        return new DextoRuntimeError(
            PlanErrorCode.STORAGE_ERROR,
            'plan',
            ErrorType.SYSTEM,
            `Failed to ${operation} plan for session '${sessionId}': ${cause?.message || 'unknown error'}`,
            { operation, sessionId, cause: cause?.message },
            'Check file system permissions and try again.'
        );
    },
};
