/**
 * Telemetry-specific error codes
 * Covers initialization, dependencies, and export operations
 */

export const TelemetryErrorCode = {
    // Initialization errors
    INITIALIZATION_FAILED: 'telemetry_initialization_failed',
    NOT_INITIALIZED: 'telemetry_not_initialized',

    // Dependency errors
    DEPENDENCY_NOT_INSTALLED: 'telemetry_dependency_not_installed',
    EXPORTER_DEPENDENCY_NOT_INSTALLED: 'telemetry_exporter_dependency_not_installed',

    // Configuration errors
    INVALID_CONFIG: 'telemetry_invalid_config',

    // Shutdown errors
    SHUTDOWN_FAILED: 'telemetry_shutdown_failed',
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TelemetryErrorCode = (typeof TelemetryErrorCode)[keyof typeof TelemetryErrorCode];

export const TELEMETRY_ERROR_CODES = Object.values(
    TelemetryErrorCode
) as readonly TelemetryErrorCode[];
