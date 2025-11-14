/**
 * Logger Factory
 *
 * Creates logger instances from agent configuration.
 * Bridges the gap between agent config (LoggerConfig) and the DextoLogger implementation.
 */

import type { LoggerConfig } from './v2/schemas.js';
import type { IDextoLogger } from './v2/types.js';
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
export function createLogger(options: CreateLoggerOptions): IDextoLogger {
    const { config, agentId, component = DextoLogComponent.AGENT } = options;

    // Create transport instances from configs
    const transports = config.transports.map((transportConfig) => {
        return createTransport(transportConfig);
    });

    // Create and return logger instance
    return new DextoLogger({
        level: config.level,
        component,
        agentId,
        transports,
    });
}
