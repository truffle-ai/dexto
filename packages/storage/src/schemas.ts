import { z } from 'zod';

// Re-export all cache schemas and types
export {
    CACHE_TYPES,
    CacheConfigSchema,
    type CacheType,
    type CacheConfig,
    InMemoryCacheSchema,
    type InMemoryCacheConfig,
    RedisCacheSchema,
    type RedisCacheConfig,
} from './cache/schemas.js';

// Re-export all database schemas and types
export {
    DATABASE_TYPES,
    DatabaseConfigSchema,
    type DatabaseType,
    type DatabaseConfig,
    InMemoryDatabaseSchema,
    type InMemoryDatabaseConfig,
    SqliteDatabaseSchema,
    type SqliteDatabaseConfig,
    PostgresDatabaseSchema,
    type PostgresDatabaseConfig,
} from './database/schemas.js';

// Re-export all blob schemas and types
export {
    BLOB_STORE_TYPES,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
    type BlobStoreType,
    type BlobStoreConfig,
    type InMemoryBlobStoreConfig,
    type LocalBlobStoreConfig,
} from './blob/schemas.js';

// Import for composition
import { CacheConfigSchema } from './cache/schemas.js';
import { DatabaseConfigSchema } from './database/schemas.js';
import { BlobStoreConfigSchema } from './blob/schemas.js';

/**
 * Top-level storage configuration schema
 * Composes cache, database, and blob store configurations
 *
 * Note: detailed backend validation happens in the resolver (`@dexto/agent-config`)
 * via each image factory's `configSchema`. This schema validates only the structural
 * shape required for config parsing and defaults.
 */
export const StorageSchema = z
    .object({
        cache: CacheConfigSchema.describe('Cache configuration (fast, ephemeral)'),
        database: DatabaseConfigSchema.describe('Database configuration (persistent, reliable)'),
        blob: BlobStoreConfigSchema.describe(
            'Blob store configuration (for large, unstructured data)'
        ),
    })
    .strict()
    .describe('Storage configuration with cache, database, and blob store')
    .brand<'ValidatedStorageConfig'>();

export type StorageConfig = z.input<typeof StorageSchema>;
export type ValidatedStorageConfig = z.output<typeof StorageSchema>;
