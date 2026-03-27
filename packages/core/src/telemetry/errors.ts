import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { TelemetryErrorCode } from './error-codes.js';

/**
 * Telemetry error factory with typed methods for creating telemetry-specific errors
 * Each method creates a properly typed error with TELEMETRY scope
 */
export class TelemetryError {
    /**
     * Required OpenTelemetry dependencies not installed
     */
    static dependencyNotInstalled(packages: string[]): DextoRuntimeError {
        return new DextoRuntimeError(
            TelemetryErrorCode.DEPENDENCY_NOT_INSTALLED,
            'telemetry',
            'user',
            'Telemetry is enabled but required OpenTelemetry packages are not installed.',
            {
                packages,
                hint: `Install with: npm install ${packages.join(' ')}`,
                recovery: 'Or disable telemetry by setting enabled: false in your configuration.',
            }
        );
    }

    /**
     * Specific exporter dependency not installed (gRPC or HTTP)
     */
    static exporterDependencyNotInstalled(
        exporterType: 'grpc' | 'http',
        packageName: string
    ): DextoRuntimeError {
        return new DextoRuntimeError(
            TelemetryErrorCode.EXPORTER_DEPENDENCY_NOT_INSTALLED,
            'telemetry',
            'user',
            `OTLP ${exporterType.toUpperCase()} exporter configured but '${packageName}' is not installed.`,
            {
                exporterType,
                packageName,
                hint: `Install with: npm install ${packageName}`,
            }
        );
    }

    /**
     * Telemetry initialization failed
     */
    static initializationFailed(reason: string, originalError?: unknown): DextoRuntimeError {
        return new DextoRuntimeError(
            TelemetryErrorCode.INITIALIZATION_FAILED,
            'telemetry',
            'system',
            `Failed to initialize telemetry: ${reason}`,
            {
                reason,
                originalError:
                    originalError instanceof Error ? originalError.message : String(originalError),
            }
        );
    }

    /**
     * Telemetry not initialized when expected
     */
    static notInitialized(): DextoRuntimeError {
        return new DextoRuntimeError(
            TelemetryErrorCode.NOT_INITIALIZED,
            'telemetry',
            'user',
            'Telemetry not initialized. Call Telemetry.init() first.',
            {
                hint: 'Ensure telemetry is initialized before accessing the global instance.',
            }
        );
    }

    /**
     * Telemetry shutdown failed (non-blocking warning)
     */
    static shutdownFailed(reason: string): DextoRuntimeError {
        return new DextoRuntimeError(
            TelemetryErrorCode.SHUTDOWN_FAILED,
            'telemetry',
            'system',
            `Telemetry shutdown failed: ${reason}`,
            { reason }
        );
    }
}
