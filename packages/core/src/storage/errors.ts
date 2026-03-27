import { DextoRuntimeError, DextoValidationError } from '../errors/index.js';

/**
 * Storage error factory with typed methods for creating storage-specific errors
 * Includes cache, database, and blob storage errors
 * Each method creates a properly typed error with STORAGE scope
 */
export class StorageError {
    /**
     * Connection failed error
     */
    static connectionFailed(reason: string, config?: Record<string, unknown>) {
        return new DextoRuntimeError(
            'storage_connection_failed',
            'storage',
            'third_party',
            `Storage connection failed: ${reason}`,
            { reason, config }
        );
    }

    /**
     * Backend not connected error
     */
    static notConnected(backendType: string) {
        return new DextoRuntimeError(
            'storage_connection_failed',
            'storage',
            'system',
            `${backendType} not connected`,
            { backendType }
        );
    }

    /**
     * Storage manager not initialized
     */
    static managerNotInitialized(method: string) {
        return new DextoRuntimeError(
            'storage_manager_not_initialized',
            'storage',
            'user',
            `StorageManager is not initialized. Call initialize() before ${method}()`,
            { method, hint: 'Call await manager.initialize() first' }
        );
    }

    /**
     * Storage manager not connected
     */
    static managerNotConnected(method: string) {
        return new DextoRuntimeError(
            'storage_manager_not_connected',
            'storage',
            'user',
            `StorageManager is not connected. Call connect() before ${method}()`,
            { method, hint: 'Call await manager.connect() after initialize()' }
        );
    }

    /**
     * Required storage dependency not installed
     */
    static dependencyNotInstalled(
        backendType: string,
        packageName: string,
        installCommand: string
    ) {
        return new DextoRuntimeError(
            'storage_dependency_not_installed',
            'storage',
            'user',
            `${backendType} storage configured but '${packageName}' package is not installed`,
            {
                backendType,
                packageName,
                hint: `Install with: ${installCommand}`,
                recovery: `Either install the package or change storage type to 'in-memory'`,
            }
        );
    }

    /**
     * Read operation failed
     */
    static readFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            'storage_read_failed',
            'storage',
            'system',
            `Storage read failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Write operation failed
     */
    static writeFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            'storage_write_failed',
            'storage',
            'system',
            `Storage write failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Delete operation failed
     */
    static deleteFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            'storage_delete_failed',
            'storage',
            'system',
            `Storage delete failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    /**
     * Migration failed error
     */
    static migrationFailed(reason: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            'storage_migration_failed',
            'storage',
            'system',
            `Database migration failed: ${reason}`,
            { reason, ...details }
        );
    }

    /**
     * Invalid database configuration
     */
    static databaseInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): DextoValidationError {
        return new DextoValidationError([
            {
                code: 'storage_database_invalid_config',
                message,
                scope: 'storage',
                type: 'user',
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    /**
     * Invalid cache configuration
     */
    static cacheInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): DextoValidationError {
        return new DextoValidationError([
            {
                code: 'storage_cache_invalid_config',
                message,
                scope: 'storage',
                type: 'user',
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    // ==================== Blob Storage Errors ====================

    /**
     * Invalid blob configuration
     */
    static blobInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): DextoValidationError {
        return new DextoValidationError([
            {
                code: 'BLOB_INVALID_CONFIG',
                message,
                scope: 'storage',
                type: 'user',
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    /**
     * Blob size exceeded maximum
     */
    static blobSizeExceeded(size: number, maxSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_SIZE_EXCEEDED',
            'storage',
            'user',
            `Blob size ${size} bytes exceeds maximum ${maxSize} bytes`,
            { size, maxSize }
        );
    }

    /**
     * Total blob storage size exceeded
     */
    static blobTotalSizeExceeded(totalSize: number, maxTotalSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_TOTAL_SIZE_EXCEEDED',
            'storage',
            'system',
            `Total storage size ${totalSize} bytes exceeds maximum ${maxTotalSize} bytes`,
            { totalSize, maxTotalSize }
        );
    }

    /**
     * Invalid blob input
     */
    static blobInvalidInput(input: unknown, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_INVALID_INPUT',
            'storage',
            'user',
            `Invalid blob input: ${reason}`,
            { inputType: typeof input, reason }
        );
    }

    /**
     * Blob encoding error
     */
    static blobEncodingError(operation: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_ENCODING_ERROR',
            'storage',
            'system',
            `Blob ${operation} failed: encoding error`,
            { operation, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    /**
     * Blob not found
     */
    static blobNotFound(reference: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_NOT_FOUND',
            'storage',
            'not_found',
            `Blob not found: ${reference}`,
            { reference }
        );
    }

    /**
     * Invalid blob reference
     */
    static blobInvalidReference(reference: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_INVALID_REFERENCE',
            'storage',
            'user',
            `Invalid blob reference '${reference}': ${reason}`,
            { reference, reason }
        );
    }

    /**
     * Blob access denied
     */
    static blobAccessDenied(reference: string, operation: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_ACCESS_DENIED',
            'storage',
            'forbidden',
            `Access denied for blob ${operation}: ${reference}`,
            { reference, operation }
        );
    }

    /**
     * Blob data corrupted
     */
    static blobCorrupted(reference: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_CORRUPTED',
            'storage',
            'system',
            `Blob data corrupted: ${reference} (${reason})`,
            { reference, reason }
        );
    }

    /**
     * Blob backend not connected
     */
    static blobBackendNotConnected(backendType: string): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_BACKEND_NOT_CONNECTED',
            'storage',
            'third_party',
            `Blob backend ${backendType} is not connected`,
            { backendType }
        );
    }

    /**
     * Blob backend unavailable
     */
    static blobBackendUnavailable(backendType: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_BACKEND_UNAVAILABLE',
            'storage',
            'third_party',
            `Blob backend ${backendType} is unavailable`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    /**
     * Blob cleanup failed
     */
    static blobCleanupFailed(backendType: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_CLEANUP_FAILED',
            'storage',
            'system',
            `Blob cleanup failed for backend ${backendType}`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    /**
     * Blob operation failed
     */
    static blobOperationFailed(
        operation: string,
        backendType: string,
        error: unknown
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            'BLOB_OPERATION_FAILED',
            'storage',
            'system',
            `Blob ${operation} failed for backend ${backendType}`,
            {
                operation,
                backendType,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }

    // Note: Registry-era provider errors were removed as part of the DI refactor.
}
