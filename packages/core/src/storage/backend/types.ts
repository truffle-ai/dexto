import type { Cache } from '../cache/cache.js';
import type { Database } from '../database/database.js';

// Re-export interfaces
export type { Cache, Database };

// Re-export schema types for convenience
export type {
    BackendConfig,
    StorageConfig,
    ValidatedStorageConfig,
    InMemoryBackendConfig,
    RedisBackendConfig,
    SqliteBackendConfig,
    PostgresBackendConfig,
} from '../schemas.js';

/**
 * Collection of storage backends for different use cases
 */
export interface StorageBackends {
    cache: Cache; // Fast, ephemeral (Redis, Memory)
    database: Database; // Persistent, reliable (PostgreSQL, SQLite, Memory)
}
