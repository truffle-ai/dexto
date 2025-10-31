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
}
