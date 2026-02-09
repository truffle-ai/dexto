/**
 * Built-in database providers.
 *
 * During the DI refactor, custom providers are resolved by product layers (CLI/server/platform)
 * via typed image factories (`@dexto/agent-config`), not via core registries.
 */

export { inMemoryDatabaseProvider } from './memory.js';
export { sqliteDatabaseProvider } from './sqlite.js';
export { postgresDatabaseProvider } from './postgres.js';
