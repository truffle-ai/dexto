/**
 * Todo Service Errors
 *
 * Error factory for todo list management operations
 */

import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { TodoErrorCode } from './error-codes.js';

/**
 * Factory class for creating Todo-related errors
 */
export class TodoError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): DextoRuntimeError {
        return new DextoRuntimeError(
            TodoErrorCode.SERVICE_NOT_INITIALIZED,
            ErrorScope.TODO,
            ErrorType.SYSTEM,
            'TodoService has not been initialized',
            {},
            'Initialize the TodoService before using it'
        );
    }

    /**
     * Todo limit exceeded error
     */
    static todoLimitExceeded(current: number, max: number): DextoRuntimeError {
        return new DextoRuntimeError(
            TodoErrorCode.TODO_LIMIT_EXCEEDED,
            ErrorScope.TODO,
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
            TodoErrorCode.INVALID_TODO_STATUS,
            ErrorScope.TODO,
            ErrorType.USER,
            `Invalid todo status: ${status}. Must be 'pending', 'in_progress', or 'completed'`,
            { status }
        );
    }

    /**
     * Database error
     */
    static databaseError(operation: string, cause: string): DextoRuntimeError {
        return new DextoRuntimeError(
            TodoErrorCode.DATABASE_ERROR,
            ErrorScope.TODO,
            ErrorType.SYSTEM,
            `Database error during ${operation}: ${cause}`,
            { operation, cause }
        );
    }
}
