/**
 * Dexto Logger
 *
 * Main logger implementation with multi-transport support.
 * Supports structured logging, component-based categorization, and per-agent isolation.
 */

import type { Logger, LoggerTransport, LogEntry, LogLevel, DextoLogComponent } from './types.js';

export interface DextoLoggerConfig {
    /** Minimum log level to record */
    level: LogLevel;
    /** Component identifier */
    component: DextoLogComponent;
    /** Agent ID for multi-agent isolation */
    agentId: string;
    /** Optional session ID for associating logs with a session */
    sessionId?: string;
    /** Transport instances */
    transports: LoggerTransport[];
    /** Shared level reference (internal - for child loggers to share parent's level) */
    _levelRef?: { value: LogLevel };
}

/**
 * DextoLogger - Multi-transport logger with structured logging
 */
export class DextoLogger implements Logger {
    /** Shared level reference - allows parent and all children to share the same level */
    private levelRef: { value: LogLevel };
    private component: DextoLogComponent;
    private agentId: string;
    private sessionId: string | undefined;
    private transports: LoggerTransport[];

    // Log level hierarchy for filtering
    // Following Winston convention: lower number = more severe
    // If level is 'debug', logs error(0), warn(1), info(2), debug(3) but not silly(4)
    private static readonly LEVELS: Record<LogLevel, number> = {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        silly: 4,
    };

    constructor(config: DextoLoggerConfig) {
        // Use shared level ref if provided (for child loggers), otherwise create new one
        this.levelRef = config._levelRef ?? { value: config.level };
        this.component = config.component;
        this.agentId = config.agentId;
        this.sessionId = config.sessionId;
        this.transports = config.transports;
    }

    debug(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    silly(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('silly')) {
            this.log('silly', message, context);
        }
    }

    info(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('error')) {
            this.log('error', message, context);
        }
    }

    trackException(error: Error, context?: Record<string, unknown>): void {
        this.error(error.message, {
            ...context,
            errorName: error.name,
            errorStack: error.stack,
            errorType: error.constructor.name,
        });
    }

    /**
     * Internal log method that creates log entry and sends to transports
     */
    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            component: this.component,
            agentId: this.agentId,
            ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
            context,
        };

        // Send to all transports
        for (const transport of this.transports) {
            try {
                const result = transport.write(entry);
                // Handle async transports - attach rejection handler to prevent unhandled promise rejections
                if (result && typeof result === 'object' && 'catch' in result) {
                    (result as Promise<void>).catch((error) => {
                        console.error('Logger transport error:', error);
                    });
                }
            } catch (error) {
                // Don't let transport errors break logging (handles sync errors)
                console.error('Logger transport error:', error);
            }
        }
    }

    /**
     * Check if a log level should be recorded based on configured level
     * Winston convention: log if level number <= configured level number
     * So if configured is 'debug' (3), we log error(0), warn(1), info(2), debug(3) but not silly(4)
     */
    private shouldLog(level: LogLevel): boolean {
        return DextoLogger.LEVELS[level] <= DextoLogger.LEVELS[this.levelRef.value];
    }

    /**
     * Set the log level dynamically
     * Affects this logger and all child loggers (shared level reference)
     */
    setLevel(level: LogLevel): void {
        this.levelRef.value = level;
    }

    /**
     * Get the current log level
     */
    getLevel(): LogLevel {
        return this.levelRef.value;
    }

    /**
     * Get the log file path if file logging is configured
     */
    getLogFilePath(): string | null {
        // Find the FileTransport and get its path
        for (const transport of this.transports) {
            if ('getFilePath' in transport && typeof transport.getFilePath === 'function') {
                return transport.getFilePath();
            }
        }
        return null;
    }

    /**
     * Create a child logger for a different component
     * Shares the same transports and level reference but uses different component identifier
     */
    createChild(component: DextoLogComponent): DextoLogger {
        return new DextoLogger({
            level: this.levelRef.value, // Initial value (will be overridden by _levelRef)
            component,
            agentId: this.agentId,
            ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
            transports: this.transports,
            _levelRef: this.levelRef, // Share the same level reference
        });
    }

    /**
     * Cleanup all transports
     */
    async destroy(): Promise<void> {
        for (const transport of this.transports) {
            if (transport.destroy) {
                try {
                    await transport.destroy();
                } catch (error) {
                    console.error('Error destroying transport:', error);
                }
            }
        }
    }
}
