// Logger factory for dependency injection
export { createLogger } from './factory.js';
export type { CreateLoggerOptions } from './factory.js';
export {
    defaultLoggerFactory,
    DefaultLoggerFactoryConfigSchema,
} from './default-logger-factory.js';
export type { DefaultLoggerFactoryConfig } from './default-logger-factory.js';

// Multi-transport logger - v2
export type { LogLevel, LogEntry, Logger, LoggerTransport } from './v2/types.js';
export { DextoLogComponent } from './v2/types.js';
export { LoggerTransportSchema, LoggerConfigSchema } from './v2/schemas.js';
export type { LoggerTransportConfig, LoggerConfig } from './v2/schemas.js';
export type { DextoLoggerConfig } from './v2/dexto-logger.js';
export { DextoLogger } from './v2/dexto-logger.js';
export { createTransport, createTransports } from './v2/transport-factory.js';
export type { ConsoleTransportConfig } from './v2/transports/console-transport.js';
export { ConsoleTransport } from './v2/transports/console-transport.js';
export type { FileTransportConfig } from './v2/transports/file-transport.js';
export { FileTransport } from './v2/transports/file-transport.js';

// Error handling
export { LoggerError } from './v2/errors.js';
export { LoggerErrorCode } from './v2/error-codes.js';

// Legacy logger (to be removed)
export type { GlobalLoggerOptions } from './logger.js';
export { GlobalLogger, logger } from './logger.js';
