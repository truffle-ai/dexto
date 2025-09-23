import { DextoRuntimeError, DextoValidationError, ErrorScope, ErrorType } from '../errors/index.js';
import { BlobErrorCode } from './error-codes.js';

/**
 * Error factory for blob service errors following Dexto error patterns
 */
export class BlobError {
    // Configuration errors
    static invalidConfig(message: string, context?: Record<string, unknown>): DextoValidationError {
        return new DextoValidationError([
            {
                code: BlobErrorCode.BLOB_INVALID_CONFIG,
                message,
                scope: ErrorScope.BLOB,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    static invalidBackendType(backendType: string): DextoValidationError {
        return new DextoValidationError([
            {
                code: BlobErrorCode.BLOB_INVALID_BACKEND_TYPE,
                message: `Unsupported backend type: ${backendType}`,
                scope: ErrorScope.BLOB,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: { backendType },
            },
        ]);
    }

    static backendConfigMissing(backendType: string): DextoValidationError {
        return new DextoValidationError([
            {
                code: BlobErrorCode.BLOB_BACKEND_CONFIG_MISSING,
                message: `Configuration required for backend type: ${backendType}`,
                scope: ErrorScope.BLOB,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: { backendType },
            },
        ]);
    }

    // Storage errors
    static sizeExceeded(size: number, maxSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_SIZE_EXCEEDED,
            ErrorScope.BLOB,
            ErrorType.USER,
            `Blob size ${size} bytes exceeds maximum ${maxSize} bytes`,
            { size, maxSize }
        );
    }

    static totalSizeExceeded(totalSize: number, maxTotalSize: number): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_TOTAL_SIZE_EXCEEDED,
            ErrorScope.BLOB,
            ErrorType.SYSTEM,
            `Total storage size ${totalSize} bytes exceeds maximum ${maxTotalSize} bytes`,
            { totalSize, maxTotalSize }
        );
    }

    static invalidInput(input: unknown, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_INVALID_INPUT,
            ErrorScope.BLOB,
            ErrorType.USER,
            `Invalid blob input: ${reason}`,
            { inputType: typeof input, reason }
        );
    }

    static encodingError(operation: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_ENCODING_ERROR,
            ErrorScope.BLOB,
            ErrorType.SYSTEM,
            `Blob ${operation} failed: encoding error`,
            { operation, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    // Retrieval errors
    static notFound(reference: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_NOT_FOUND,
            ErrorScope.BLOB,
            ErrorType.NOT_FOUND,
            `Blob not found: ${reference}`,
            { reference }
        );
    }

    static invalidReference(reference: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_INVALID_REFERENCE,
            ErrorScope.BLOB,
            ErrorType.USER,
            `Invalid blob reference '${reference}': ${reason}`,
            { reference, reason }
        );
    }

    static accessDenied(reference: string, operation: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_ACCESS_DENIED,
            ErrorScope.BLOB,
            ErrorType.FORBIDDEN,
            `Access denied for blob ${operation}: ${reference}`,
            { reference, operation }
        );
    }

    static corrupted(reference: string, reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_CORRUPTED,
            ErrorScope.BLOB,
            ErrorType.SYSTEM,
            `Blob data corrupted: ${reference} (${reason})`,
            { reference, reason }
        );
    }

    // Backend errors
    static backendNotConnected(backendType: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_BACKEND_NOT_CONNECTED,
            ErrorScope.BLOB,
            ErrorType.THIRD_PARTY,
            `Blob backend ${backendType} is not connected`,
            { backendType }
        );
    }

    static backendUnavailable(backendType: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_BACKEND_UNAVAILABLE,
            ErrorScope.BLOB,
            ErrorType.THIRD_PARTY,
            `Blob backend ${backendType} is unavailable`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    static backendTimeout(backendType: string, operation: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_BACKEND_TIMEOUT,
            ErrorScope.BLOB,
            ErrorType.TIMEOUT,
            `Blob backend ${backendType} timed out during ${operation}`,
            { backendType, operation }
        );
    }

    static credentialsInvalid(backendType: string): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_BACKEND_CREDENTIALS_INVALID,
            ErrorScope.BLOB,
            ErrorType.FORBIDDEN,
            `Invalid credentials for blob backend ${backendType}`,
            { backendType }
        );
    }

    // Operation errors
    static cleanupFailed(backendType: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_CLEANUP_FAILED,
            ErrorScope.BLOB,
            ErrorType.SYSTEM,
            `Blob cleanup failed for backend ${backendType}`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    static operationFailed(
        operation: string,
        backendType: string,
        error: unknown
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            BlobErrorCode.BLOB_OPERATION_FAILED,
            ErrorScope.BLOB,
            ErrorType.SYSTEM,
            `Blob ${operation} failed for backend ${backendType}`,
            {
                operation,
                backendType,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }
}
