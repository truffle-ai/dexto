/**
 * Orchestration Service Errors
 *
 * Error factory for todo list management operations
 */

import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { OrchestrationErrorCode } from './error-codes.js';

/**
 * Factory class for creating Orchestration-related errors
 */
export class OrchestrationError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.SERVICE_NOT_INITIALIZED,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            'OrchestrationService has not been initialized',
            {},
            'Initialize the OrchestrationService before using it'
        );
    }

    /**
     * Invalid configuration error
     */
    static invalidConfig(reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.INVALID_CONFIG,
            ErrorScope.ORCHESTRATION,
            ErrorType.USER,
            `Invalid Orchestration configuration: ${reason}`,
            { reason }
        );
    }

    /**
     * Todo not found error
     */
    static todoNotFound(todoId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TODO_NOT_FOUND,
            ErrorScope.ORCHESTRATION,
            ErrorType.NOT_FOUND,
            `Todo not found: ${todoId}`,
            { todoId }
        );
    }

    /**
     * Todo limit exceeded error
     */
    static todoLimitExceeded(current: number, max: number): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TODO_LIMIT_EXCEEDED,
            ErrorScope.ORCHESTRATION,
            ErrorType.USER,
            `Todo limit exceeded: ${current} todos. Maximum allowed: ${max}`,
            { current, max },
            'Complete or delete existing todos before adding new ones'
        );
    }

    /**
     * Invalid todo status error
     */
    static invalidStatus(status: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.INVALID_TODO_STATUS,
            ErrorScope.ORCHESTRATION,
            ErrorType.USER,
            `Invalid todo status: ${status}. Must be 'pending', 'in_progress', or 'completed'`,
            { status }
        );
    }

    /**
     * Todo update failed error
     */
    static updateFailed(todoId: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TODO_UPDATE_FAILED,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            `Failed to update todo ${todoId}: ${cause}`,
            { todoId, cause }
        );
    }

    /**
     * Todo creation failed error
     */
    static createFailed(cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TODO_CREATE_FAILED,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            `Failed to create todo: ${cause}`,
            { cause }
        );
    }

    /**
     * Todo deletion failed error
     */
    static deleteFailed(todoId: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TODO_DELETE_FAILED,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            `Failed to delete todo ${todoId}: ${cause}`,
            { todoId, cause }
        );
    }

    /**
     * Session not found error
     */
    static sessionNotFound(sessionId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.SESSION_NOT_FOUND,
            ErrorScope.ORCHESTRATION,
            ErrorType.NOT_FOUND,
            `Session not found: ${sessionId}`,
            { sessionId }
        );
    }

    /**
     * Database error
     */
    static databaseError(operation: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.DATABASE_ERROR,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            `Database error during ${operation}: ${cause}`,
            { operation, cause }
        );
    }

    /**
     * Transaction failed error
     */
    static transactionFailed(cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            OrchestrationErrorCode.TRANSACTION_FAILED,
            ErrorScope.ORCHESTRATION,
            ErrorType.SYSTEM,
            `Transaction failed: ${cause}`,
            { cause }
        );
    }
}
