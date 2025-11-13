import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LoggerErrorCode } from './error-codes.js';

/**
 * Logger error factory with typed methods for creating logger-specific errors
 * Each method creates a properly typed error with LOGGER scope
 */
export class LoggerError {
    /**
     * Transport not yet implemented
     */
    static transportNotImplemented(
        transportType: string,
        availableTransports: string[]
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.TRANSPORT_NOT_IMPLEMENTED,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `${transportType} transport not yet implemented. Available transports: ${availableTransports.join(', ')}`,
            { transportType, availableTransports }
        );
    }

    /**
     * Unknown transport type
     */
    static unknownTransportType(transportType: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.TRANSPORT_UNKNOWN_TYPE,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Unknown transport type: ${transportType}`,
            { transportType }
        );
    }

    /**
     * Transport initialization failed
     */
    static transportInitializationFailed(
        transportType: string,
        reason: string,
        details?: Record<string, unknown>
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.TRANSPORT_INITIALIZATION_FAILED,
            ErrorScope.LOGGER,
            ErrorType.SYSTEM,
            `Failed to initialize ${transportType} transport: ${reason}`,
            { transportType, reason, ...details }
        );
    }

    /**
     * Transport write operation failed
     */
    static transportWriteFailed(transportType: string, error: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.TRANSPORT_WRITE_FAILED,
            ErrorScope.LOGGER,
            ErrorType.SYSTEM,
            `Transport write failed for ${transportType}`,
            {
                transportType,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }

    /**
     * Invalid logger configuration
     */
    static invalidConfig(message: string, context?: Record<string, unknown>): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.INVALID_CONFIG,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Invalid logger configuration: ${message}`,
            context
        );
    }

    /**
     * Invalid log level
     */
    static invalidLogLevel(level: string, validLevels: string[]): DextoRuntimeError {
        return new DextoRuntimeError(
            LoggerErrorCode.INVALID_LOG_LEVEL,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Invalid log level '${level}'. Valid levels: ${validLevels.join(', ')}`,
            { level, validLevels }
        );
    }
}
