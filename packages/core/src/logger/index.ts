// New multi-transport logger (Phase 1A) - v2 subfolder
export * from './v2/types.js';
export * from './v2/schemas.js';
export * from './v2/dexto-logger.js';
export * from './v2/transport-factory.js';
export * from './v2/transports/console-transport.js';
export * from './v2/transports/file-transport.js';

// Legacy logger (to be migrated)
export * from './logger.js';
