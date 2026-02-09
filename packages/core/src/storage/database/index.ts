/**
 * Database Module
 *
 * This module provides a flexible database system with support for
 * multiple backends through a provider pattern.
 *
 * ## Built-in Providers
 * - `in-memory`: Store data in RAM (for testing/development)
 * - `sqlite`: Store data in a local SQLite file
 * - `postgres`: Store data in PostgreSQL server
 *
 * ## Custom Providers
 * During the DI refactor, custom providers are resolved by product layers (CLI/server/platform)
 * via typed image factories (`@dexto/agent-config`), not via core registries.
 *
 * ## Usage
 *
 * ### Using built-in providers
 * ```typescript
 * import { createDatabase } from '@dexto/core';
 *
 * const db = await createDatabase({ type: 'sqlite', path: '/tmp/data.db' }, logger);
 * ```
 */

// Export public API
export { createDatabase } from './factory.js';
export type { DatabaseProvider } from './provider.js';

// Export types and interfaces
export type { Database } from './types.js';

// Export built-in providers (plain exports; no auto-registration)
export {
    inMemoryDatabaseProvider,
    sqliteDatabaseProvider,
    postgresDatabaseProvider,
} from './providers/index.js';

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
