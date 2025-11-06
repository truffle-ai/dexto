// Logger factory for dependency injection
export { createLogger } from './factory.js';
export type { CreateLoggerOptions } from './factory.js';

// New multi-transport logger (Phase 1A) - v2 subfolder
export * from './v2/types.js';
export * from './v2/schemas.js';
export * from './v2/dexto-logger.js';
export * from './v2/transport-factory.js';
export * from './v2/transports/console-transport.js';
export * from './v2/transports/file-transport.js';

// Legacy logger (to be migrated) - Logger class, types, and singleton
export type { LoggerOptions } from './logger.js';
export { Logger, logger } from './logger.js';
