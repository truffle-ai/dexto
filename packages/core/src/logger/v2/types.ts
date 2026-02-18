/**
 * Logger Types and Interfaces
 *
 * Defines the core abstractions for the multi-transport logger architecture.
 */

/**
 * Log levels in order of severity
 * Following Winston convention: error < warn < info < debug < silly
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silly';

/**
 * Component identifiers for structured logging
 * Mirrors ErrorScope for consistency, with additional execution context components
 */
export enum DextoLogComponent {
    // Core functional domains (matches ErrorScope)
    AGENT = 'agent',
    LLM = 'llm',
    CONFIG = 'config',
    CONTEXT = 'context',
    SESSION = 'session',
    MCP = 'mcp',
    TOOLS = 'tools',
    STORAGE = 'storage',
    SYSTEM_PROMPT = 'system_prompt',
    RESOURCE = 'resource',
    PROMPT = 'prompt',
    MEMORY = 'memory',
    HOOK = 'hook',
    FILESYSTEM = 'filesystem',
    PROCESS = 'process',
    APPROVAL = 'approval',

    // Additional execution context components
    API = 'api',
    CLI = 'cli',
    TELEMETRY = 'telemetry',
    EXECUTOR = 'executor',
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
    /** Optional session ID for multi-session isolation */
    sessionId?: string;
    /** Optional structured context data */
    context?: Record<string, unknown> | undefined;
}

/**
 * Logger type
 * All logger implementations must implement this shape.
 */
export type Logger = {
    /**
     * Log debug message
     * @param message Log message
     * @param context Optional structured context
     */
    debug(message: string, context?: Record<string, unknown>): void;

    /**
     * Log silly message (most verbose, for detailed debugging like full JSON dumps)
     * @param message Log message
     * @param context Optional structured context
     */
    silly(message: string, context?: Record<string, unknown>): void;

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

    /**
     * Create a child logger with a different component
     * Shares the same transports, agentId, and level but uses a different component identifier
     * @param component Component identifier for the child logger
     * @returns New logger instance with specified component
     */
    createChild(component: DextoLogComponent): Logger;

    /**
     * Set the log level dynamically
     * Affects this logger and all child loggers created from it (shared level reference)
     * @param level New log level
     */
    setLevel(level: LogLevel): void;

    /**
     * Get the current log level
     * @returns Current log level
     */
    getLevel(): LogLevel;

    /**
     * Get the log file path if file logging is enabled
     * @returns Log file path or null if file logging is not configured
     */
    getLogFilePath(): string | null;

    /**
     * Cleanup resources and close transports
     */
    destroy(): Promise<void>;
};

/**
 * Base transport interface
 * All transport implementations must implement this interface
 */
export type LoggerTransport = {
    /**
     * Write a log entry to the transport
     * @param entry Structured log entry
     */
    write(entry: LogEntry): void | Promise<void>;

    /**
     * Cleanup resources when logger is destroyed
     */
    destroy?(): void | Promise<void>;
};
