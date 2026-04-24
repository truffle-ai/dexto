/**
 * Database Module
 *
 * This module provides a flexible database system with support for
 * multiple concrete backends.
 *
 * ## Usage
 * Database backends are typically constructed by an image's storage implementation after
 * validating config with the matching schema.
 */

// Export types and interfaces
export type { Database } from './types.js';

// Export schemas and config types
export {
    DATABASE_TYPES,
    DatabaseConfigSchema,
    InMemoryDatabaseSchema,
    SqliteDatabaseSchema,
    PostgresDatabaseSchema,
    type DatabaseType,
    type DatabaseConfig,
    type InMemoryDatabaseConfig,
    type SqliteDatabaseConfig,
    type PostgresDatabaseConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { MemoryDatabaseStore } from './memory-database-store.js';
export { SQLiteStore } from './sqlite-store.js';
export { PostgresStore } from './postgres-store.js';
