/**
 * Database Module
 *
 * This module provides a flexible database system with support for
 * multiple backends through a factory pattern.
 *
 * ## Built-in Factories
 * - `in-memory`: Store data in RAM (for testing/development)
 * - `sqlite`: Store data in a local SQLite file
 * - `postgres`: Store data in PostgreSQL server
 *
 * ## Custom Factories
 * Product layers (CLI/server/platform) decide which factories are available by including them
 * in images (`DextoImageModule.storage.database`).
 *
 * ## Usage
 * Database backends are typically constructed by the product-layer resolver (`@dexto/agent-config`)
 * via image-provided factory maps. For direct usage, call a factory's `create()` after validating
 * config with its `configSchema`.
 */

// Export public API
export type { DatabaseFactory } from './factory.js';

// Export types and interfaces
export type { Database } from './types.js';

// Export built-in factories (plain exports; no registries)
export {
    inMemoryDatabaseFactory,
    sqliteDatabaseFactory,
    postgresDatabaseFactory,
} from './factories/index.js';

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
