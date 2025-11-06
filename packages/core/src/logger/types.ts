/**
 * Logger Types and Interfaces
 *
 * Defines the core abstractions for the multi-transport logger architecture.
 * Based on Mastra's transport pattern with Dexto-specific adaptations.
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Component identifiers for structured logging
 * Allows filtering logs by component
 */
export enum DextoLogComponent {
    AGENT = 'AGENT',
    LLM = 'LLM',
    MCP = 'MCP',
    STORAGE = 'STORAGE',
    SESSION = 'SESSION',
    TOOL = 'TOOL',
    PLUGIN = 'PLUGIN',
    API = 'API',
    CLI = 'CLI',
    FILESYSTEM = 'FILESYSTEM',
    TELEMETRY = 'TELEMETRY',
}

/**
 * Structured log entry
 * All logs are converted to this format before being sent to transports
 */
export interface LogEntry {
    /** Log level */
    level: LogLevel;
    /** Primary log message */
    message: string;
    /** ISO timestamp */
    timestamp: string;
    /** Component that generated the log */
    component: DextoLogComponent;
    /** Agent ID for multi-agent isolation */
    agentId: string;
    /** Optional structured context data */
    context?: Record<string, unknown>;
}

/**
 * Logger interface
 * All logger implementations must implement this interface
 */
export interface IDextoLogger {
    /**
     * Log debug message
     * @param message Log message
     * @param context Optional structured context
     */
    debug(message: string, context?: Record<string, unknown>): void;

    /**
     * Log info message
     * @param message Log message
     * @param context Optional structured context
     */
    info(message: string, context?: Record<string, unknown>): void;

    /**
     * Log warning message
     * @param message Log message
     * @param context Optional structured context
     */
    warn(message: string, context?: Record<string, unknown>): void;

    /**
     * Log error message
     * @param message Log message
     * @param context Optional structured context
     */
    error(message: string, context?: Record<string, unknown>): void;

    /**
     * Track exception with stack trace
     * @param error Error object
     * @param context Optional additional context
     */
    trackException(error: Error, context?: Record<string, unknown>): void;
}

/**
 * Base transport interface
 * All transport implementations must implement this interface
 */
export interface ILoggerTransport {
    /**
     * Write a log entry to the transport
     * @param entry Structured log entry
     */
    write(entry: LogEntry): void | Promise<void>;

    /**
     * Cleanup resources when logger is destroyed
     */
    destroy?(): void | Promise<void>;
}
