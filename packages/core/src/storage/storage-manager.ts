import type { Cache } from './cache/cache.js';
import type { Database } from './database/database.js';
import type { BlobStore } from './blob/blob-store.js';
import type {
    PostgresBackendConfig,
    RedisBackendConfig,
    SqliteBackendConfig,
    LocalBlobBackendConfig,
    ValidatedStorageConfig,
} from './schemas.js';
import { MemoryCacheStore } from './cache/memory-cache-store.js';
import { MemoryDatabaseStore } from './database/memory-database-store.js';
import { LocalBlobStore } from './blob/local-blob-store.js';
import { logger } from '../logger/index.js';

// Lazy imports for optional dependencies
let SQLiteStore: any;
let RedisStore: any;
let PostgresStore: any;

const HEALTH_CHECK_KEY = 'storage_manager_health_check';

/**
 * Storage manager that initializes and manages storage backends.
 * Handles cache, database, and blob backends with automatic fallbacks.
 */
export class StorageManager {
    private config: ValidatedStorageConfig;
    private cache!: Cache;
    private database!: Database;
    private blobStore!: BlobStore;
    private connected = false;

    constructor(config: ValidatedStorageConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        // Initialize cache
        this.cache = await this.createCache();
        await this.cache.connect();

        // Initialize database
        this.database = await this.createDatabase();
        await this.database.connect();

        // Initialize blob store
        this.blobStore = this.createBlob();
        await this.blobStore.connect();

        this.connected = true;
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        await this.cache.disconnect();
        await this.database.disconnect();
        await this.blobStore.disconnect();

        this.connected = false;
    }

    isConnected(): boolean {
        return (
            this.connected &&
            this.cache.isConnected() &&
            this.database.isConnected() &&
            this.blobStore.isConnected()
        );
    }

    /**
     * Get the cache store instance.
     * @throws Error if not connected
     */
    getCache(): Cache {
        if (!this.connected) {
            throw new Error('StorageManager is not connected. Call connect() first.');
        }
        return this.cache;
    }

    /**
     * Get the database store instance.
     * @throws Error if not connected
     */
    getDatabase(): Database {
        if (!this.connected) {
            throw new Error('StorageManager is not connected. Call connect() first.');
        }
        return this.database;
    }

    /**
     * Get the blob store instance.
     * @throws Error if not connected
     */
    getBlobStore(): BlobStore {
        if (!this.connected) {
            throw new Error('StorageManager is not connected. Call connect() first.');
        }
        return this.blobStore;
    }

    private async createCache(): Promise<Cache> {
        const cacheConfig = this.config.cache;

        switch (cacheConfig.type) {
            case 'redis':
                return this.createRedisStore(cacheConfig);

            case 'in-memory':
            default:
                logger.info('Using in-memory cache store');
                return new MemoryCacheStore();
        }
    }

    private async createDatabase(): Promise<Database> {
        const dbConfig = this.config.database;

        switch (dbConfig.type) {
            case 'postgres':
                return this.createPostgresStore(dbConfig);

            case 'sqlite':
                return this.createSQLiteStore(dbConfig);

            case 'in-memory':
            default:
                logger.info('Using in-memory database store');
                return new MemoryDatabaseStore();
        }
    }

    private createBlob(): BlobStore {
        const blobConfig = this.config.blob;

        switch (blobConfig.type) {
            case 'local':
                logger.info('Using local blob store');
                return new LocalBlobStore(blobConfig);

            case 'in-memory':
            default: {
                logger.info('Using in-memory blob store (falling back to local)');
                // For now we don't have MemoryBlobStore, use LocalBlobStore with in-memory config converted to local
                const localConfig: LocalBlobBackendConfig = {
                    type: 'local',
                    maxBlobSize: blobConfig.maxBlobSize,
                    maxTotalSize: blobConfig.maxTotalSize,
                    cleanupAfterDays: 30, // Default for fallback
                };
                return new LocalBlobStore(localConfig);
            }
        }
    }

    private async createRedisStore(config: RedisBackendConfig): Promise<Cache> {
        try {
            if (!RedisStore) {
                const module = await import('./cache/redis-store.js');
                RedisStore = module.RedisStore;
            }
            logger.info(`Connecting to Redis at ${config.host}:${config.port}`);
            return new RedisStore(config);
        } catch (error) {
            logger.warn(`Redis not available, falling back to in-memory cache: ${error}`);
            return new MemoryCacheStore();
        }
    }

    private async createPostgresStore(config: PostgresBackendConfig): Promise<Database> {
        try {
            if (!PostgresStore) {
                const module = await import('./database/postgres-store.js');
                PostgresStore = module.PostgresStore;
            }
            logger.info('Connecting to PostgreSQL database');
            return new PostgresStore(config);
        } catch (error) {
            logger.warn(`PostgreSQL not available, falling back to in-memory database: ${error}`);
            return new MemoryDatabaseStore();
        }
    }

    private async createSQLiteStore(config: SqliteBackendConfig): Promise<Database> {
        try {
            if (!SQLiteStore) {
                const module = await import('./database/sqlite-store.js');
                SQLiteStore = module.SQLiteStore;
            }
            logger.info(`Using SQLite database at ${config.path}`);
            return new SQLiteStore(config);
        } catch (error) {
            logger.error(
                `SQLite store failed to load: ${error instanceof Error ? error.message : String(error)}`
            );
            logger.error(`Full error details: ${JSON.stringify(error)}`);
            logger.warn('Falling back to in-memory database store');
            return new MemoryDatabaseStore();
        }
    }

    // Utility methods
    async getInfo(): Promise<{
        cache: { type: string; connected: boolean };
        database: { type: string; connected: boolean };
        blob: { type: string; connected: boolean };
        connected: boolean;
    }> {
        if (!this.connected) {
            throw new Error('StorageManager is not connected. Call connect() first.');
        }

        return {
            cache: {
                type: this.cache.getStoreType(),
                connected: this.cache.isConnected(),
            },
            database: {
                type: this.database.getStoreType(),
                connected: this.database.isConnected(),
            },
            blob: {
                type: this.blobStore.getStoreType(),
                connected: this.blobStore.isConnected(),
            },
            connected: this.connected,
        };
    }

    // Health check
    async healthCheck(): Promise<{
        cache: boolean;
        database: boolean;
        blob: boolean;
        overall: boolean;
    }> {
        if (!this.connected) {
            throw new Error('StorageManager is not connected. Call connect() first.');
        }

        let cacheHealthy = false;
        let databaseHealthy = false;
        let blobHealthy = false;

        try {
            if (this.cache.isConnected()) {
                await this.cache.set(HEALTH_CHECK_KEY, 'ok', 10);
                const result = await this.cache.get(HEALTH_CHECK_KEY);
                cacheHealthy = result === 'ok';
                await this.cache.delete(HEALTH_CHECK_KEY);
            }
        } catch (error) {
            logger.warn(`Cache health check failed: ${error}`);
        }

        try {
            if (this.database.isConnected()) {
                await this.database.set(HEALTH_CHECK_KEY, 'ok');
                const result = await this.database.get(HEALTH_CHECK_KEY);
                databaseHealthy = result === 'ok';
                await this.database.delete(HEALTH_CHECK_KEY);
            }
        } catch (error) {
            logger.warn(`Database health check failed: ${error}`);
        }

        try {
            if (this.blobStore.isConnected()) {
                // For blob store, just check if it's connected (no data operations)
                blobHealthy = this.blobStore.isConnected();
            }
        } catch (error) {
            logger.warn(`Blob store health check failed: ${error}`);
        }

        return {
            cache: cacheHealthy,
            database: databaseHealthy,
            blob: blobHealthy,
            overall: cacheHealthy && databaseHealthy && blobHealthy,
        };
    }
}

/**
 * Create and initialize a storage manager.
 * This allows multiple agent instances to have independent storage.
 */
export async function createStorageManager(
    config: ValidatedStorageConfig
): Promise<StorageManager> {
    const manager = new StorageManager(config);
    await manager.connect();
    return manager;
}
