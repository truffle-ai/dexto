/**
 * Dexto Logger
 *
 * Main logger implementation with multi-transport support.
 * Supports structured logging, component-based categorization, and per-agent isolation.
 */

import type {
    IDextoLogger,
    ILoggerTransport,
    LogEntry,
    LogLevel,
    DextoLogComponent,
} from './types.js';

export interface DextoLoggerConfig {
    /** Minimum log level to record */
    level: LogLevel;
    /** Component identifier */
    component: DextoLogComponent;
    /** Agent ID for multi-agent isolation */
    agentId: string;
    /** Transport instances */
    transports: ILoggerTransport[];
}

/**
 * DextoLogger - Multi-transport logger with structured logging
 */
export class DextoLogger implements IDextoLogger {
    private level: LogLevel;
    private component: DextoLogComponent;
    private agentId: string;
    private transports: ILoggerTransport[];

    // Log level hierarchy for filtering
    private static readonly LEVELS: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };

    constructor(config: DextoLoggerConfig) {
        this.level = config.level;
        this.component = config.component;
        this.agentId = config.agentId;
        this.transports = config.transports;
    }

    debug(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
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
            context,
        };

        // Send to all transports
        for (const transport of this.transports) {
            try {
                transport.write(entry);
            } catch (error) {
                // Don't let transport errors break logging
                console.error('Logger transport error:', error);
            }
        }
    }

    /**
     * Check if a log level should be recorded based on configured level
     */
    private shouldLog(level: LogLevel): boolean {
        return DextoLogger.LEVELS[level] >= DextoLogger.LEVELS[this.level];
    }

    /**
     * Create a child logger for a different component
     * Shares the same transports but uses different component identifier
     */
    createChild(component: DextoLogComponent): DextoLogger {
        return new DextoLogger({
            level: this.level,
            component,
            agentId: this.agentId,
            transports: this.transports,
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
