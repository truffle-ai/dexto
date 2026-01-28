/**
 * Transport Factory
 *
 * Creates transport instances from configuration.
 * Used by CLI enrichment layer to instantiate transports.
 */

import type { ILoggerTransport } from './types.js';
import type { LoggerTransportConfig } from './schemas.js';
import { SilentTransport } from './transports/silent-transport.js';
import { ConsoleTransport } from './transports/console-transport.js';
import { FileTransport } from './transports/file-transport.js';
import { LoggerError } from './errors.js';

/**
 * Create a transport instance from configuration
 * @param config Transport configuration from schema
 * @returns Transport instance
 */
export function createTransport(config: LoggerTransportConfig): ILoggerTransport {
    switch (config.type) {
        case 'silent':
            return new SilentTransport();

        case 'console':
            return new ConsoleTransport({
                colorize: config.colorize,
            });

        case 'file':
            return new FileTransport({
                path: config.path,
                maxSize: config.maxSize,
                maxFiles: config.maxFiles,
            });

        case 'upstash':
            // TODO: Implement UpstashTransport in Phase B (optional)
            throw LoggerError.transportNotImplemented('upstash', ['silent', 'console', 'file']);

        default:
            throw LoggerError.unknownTransportType((config as any).type);
    }
}

/**
 * Create multiple transports from configuration array
 * @param configs Array of transport configurations
 * @returns Array of transport instances
 */
export function createTransports(configs: LoggerTransportConfig[]): ILoggerTransport[] {
    return configs.map(createTransport);
}
