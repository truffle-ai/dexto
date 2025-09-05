import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { StorageErrorCode } from './error-codes.js';

/**
 * Storage error factory with typed methods for creating storage-specific errors
 * Each method creates a properly typed DextoRuntimeError with STORAGE scope
 */
export class StorageError {
    /**
     * Connection failed error
     */
    static connectionFailed(reason: string, config?: Record<string, unknown>) {
        return new DextoRuntimeError(
            StorageErrorCode.CONNECTION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.THIRD_PARTY,
            `Storage connection failed: ${reason}`,
            { reason, config }
        );
    }

    /**
     * Backend not connected error
     */
    static notConnected(backendType: string) {
        return new DextoRuntimeError(
            StorageErrorCode.CONNECTION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `${backendType} not connected`,
            { backendType }
        );
    }

    /**
     * Read operation failed
     */
    static readFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            StorageErrorCode.READ_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage read failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Write operation failed
     */
    static writeFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            StorageErrorCode.WRITE_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage write failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Delete operation failed
     */
    static deleteFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            StorageErrorCode.DELETE_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage delete failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Migration failed error
     */
    static migrationFailed(reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            StorageErrorCode.MIGRATION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Database migration failed: ${reason}`,
            { reason, ...details }
        );
    }
}
