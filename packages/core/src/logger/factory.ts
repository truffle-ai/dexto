/**
 * Logger Factory
 *
 * Creates logger instances from agent configuration.
 * Bridges the gap between agent config (LoggerConfig) and the DextoLogger implementation.
 */

import type { LoggerConfig } from './v2/schemas.js';
import type { Logger, LogLevel } from './v2/types.js';
import { DextoLogComponent } from './v2/types.js';
import { DextoLogger } from './v2/dexto-logger.js';
import { createTransport } from './v2/transport-factory.js';

export interface CreateLoggerOptions {
    /** Logger configuration from agent config */
    config: LoggerConfig;
    /** Agent ID for multi-agent isolation */
    agentId: string;
    /** Component identifier (defaults to AGENT) */
    component?: DextoLogComponent;
}

/**
 * Helper to get effective log level from environment or config
 * DEXTO_LOG_LEVEL environment variable takes precedence over config
 */
function getEffectiveLogLevel(configLevel: LogLevel): LogLevel {
    const envLevel = process.env.DEXTO_LOG_LEVEL;
    if (envLevel) {
        const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silly'];
        const normalizedLevel = envLevel.toLowerCase() as LogLevel;
        if (validLevels.includes(normalizedLevel)) {
            return normalizedLevel;
        }
    }
    return configLevel;
}

/**
 * Create a logger instance from agent configuration
 *
 * @param options Logger creation options
 * @returns Configured logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   config: validatedConfig.logger,
 *   agentId: 'my-agent',
 *   component: DextoLogComponent.AGENT
 * });
 *
 * logger.info('Agent started');
 * ```
 */
export function createLogger(options: CreateLoggerOptions): Logger {
    const { config, agentId, component = DextoLogComponent.AGENT } = options;

    // Override log level with DEXTO_LOG_LEVEL environment variable if present
    const effectiveLevel = getEffectiveLogLevel(config.level);

    // Create transport instances from configs
    const transports = config.transports.map((transportConfig) => {
        return createTransport(transportConfig);
    });

    // Create and return logger instance
    return new DextoLogger({
        level: effectiveLevel,
        component,
        agentId,
        transports,
    });
}
