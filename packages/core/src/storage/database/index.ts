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
 * Custom providers (e.g., MongoDB, DynamoDB) can be registered at the
 * CLI/server layer before configuration loading.
 *
 * ## Usage
 *
 * ### Using built-in providers
 * ```typescript
 * import { createDatabase } from '@dexto/core';
 *
 * const db = await createDatabase({ type: 'sqlite', path: '/tmp/data.db' }, logger);
 * ```
 *
 * ### Registering custom providers
 * ```typescript
 * import { databaseRegistry, type DatabaseProvider } from '@dexto/core';
 *
 * const mongoProvider: DatabaseProvider<'mongodb', MongoConfig> = {
 *   type: 'mongodb',
 *   configSchema: MongoConfigSchema,
 *   create: (config, logger) => new MongoDatabase(config, logger),
 * };
 *
 * databaseRegistry.register(mongoProvider);
 * const db = await createDatabase({ type: 'mongodb', uri: '...' }, logger);
 * ```
 */

// Import built-in providers
import { databaseRegistry } from './registry.js';
import {
    inMemoryDatabaseProvider,
    sqliteDatabaseProvider,
    postgresDatabaseProvider,
} from './providers/index.js';

// Register built-in providers on module load
// This ensures they're available when importing from @dexto/core
// Guard against duplicate registration when module is imported multiple times
if (!databaseRegistry.has('in-memory')) {
    databaseRegistry.register(inMemoryDatabaseProvider);
}
if (!databaseRegistry.has('sqlite')) {
    databaseRegistry.register(sqliteDatabaseProvider);
}
if (!databaseRegistry.has('postgres')) {
    databaseRegistry.register(postgresDatabaseProvider);
}

// Export public API
export { createDatabase } from './factory.js';
export { databaseRegistry, DatabaseRegistry } from './registry.js';
export type { DatabaseProvider } from './provider.js';

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
