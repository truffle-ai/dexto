import type { CacheBackend, DatabaseBackend, StorageBackends } from './backend/types.js';
import type { ValidatedStorageConfig } from './schemas.js';
import { MemoryBackend } from './backend/memory-backend.js';
import { logger } from '../logger/index.js';

// Lazy imports for optional dependencies
let SQLiteBackend: any;
let RedisBackend: any;
let PostgresBackend: any;

const HEALTH_CHECK_KEY = 'storage_manager_health_check';

/**
 * Storage manager that initializes and manages storage backends.
 * Handles both cache and database backends with automatic fallbacks.
 */
export class StorageManager {
    private config: ValidatedStorageConfig;
    private cache?: CacheBackend;
    private database?: DatabaseBackend;
    private connected = false;

    constructor(config: ValidatedStorageConfig) {
        this.config = config;
    }

    async connect(): Promise<StorageBackends> {
        if (this.connected) {
            return {
                cache: this.cache!,
                database: this.database!,
            };
        }

        // Initialize cache backend
        this.cache = await this.createCacheBackend();
        await this.cache.connect();

        // Initialize database backend
        this.database = await this.createDatabaseBackend();
        await this.database.connect();

        this.connected = true;

        return {
            cache: this.cache,
            database: this.database,
        };
    }

    async disconnect(): Promise<void> {
        if (this.cache) {
            await this.cache.disconnect();
            delete this.cache;
        }

        if (this.database) {
            await this.database.disconnect();
            delete this.database;
        }

        this.connected = false;
    }

    isConnected(): boolean {
        return (
            this.connected &&
            this.cache?.isConnected() === true &&
            this.database?.isConnected() === true
        );
    }

    getBackends(): StorageBackends | null {
        if (!this.connected) return null;

        return {
            cache: this.cache!,
            database: this.database!,
        };
    }

    private async createCacheBackend(): Promise<CacheBackend> {
        const cacheConfig = this.config.cache;

        switch (cacheConfig.type) {
            case 'redis':
                return this.createRedisBackend(cacheConfig);

            case 'in-memory':
            default:
                logger.info('Using in-memory cache backend');
                return new MemoryBackend();
        }
    }

    private async createDatabaseBackend(): Promise<DatabaseBackend> {
        const dbConfig = this.config.database;

        switch (dbConfig.type) {
            case 'postgres':
                return this.createPostgresBackend(dbConfig);

            case 'sqlite':
                return this.createSQLiteBackend(dbConfig);

            case 'in-memory':
            default:
                logger.info('Using in-memory database backend');
                return new MemoryBackend();
        }
    }

    private async createRedisBackend(config: any): Promise<CacheBackend> {
        try {
            if (!RedisBackend) {
                const module = await import('./backend/redis-backend.js');
                RedisBackend = module.RedisBackend;
            }
            logger.info(`Connecting to Redis at ${config.host}:${config.port}`);
            return new RedisBackend(config);
        } catch (error) {
            logger.warn('Redis not available, falling back to in-memory cache:', error);
            return new MemoryBackend();
        }
    }

    private async createPostgresBackend(config: any): Promise<DatabaseBackend> {
        try {
            if (!PostgresBackend) {
                const module = await import('./backend/postgres-backend.js');
                PostgresBackend = module.PostgresBackend;
            }
            logger.info('Connecting to PostgreSQL database');
            return new PostgresBackend(config);
        } catch (error) {
            logger.warn('PostgreSQL not available, falling back to in-memory database:', error);
            return new MemoryBackend();
        }
    }

    private async createSQLiteBackend(config: any): Promise<DatabaseBackend> {
        try {
            if (!SQLiteBackend) {
                const module = await import('./backend/sqlite-backend.js');
                SQLiteBackend = module.SQLiteBackend;
            }
            logger.info(`Using SQLite database at ${config.path}`);
            return new SQLiteBackend(config);
        } catch (error) {
            logger.error(
                `SQLite backend failed to load: ${error instanceof Error ? error.message : String(error)}`
            );
            logger.error(`Full error details: ${JSON.stringify(error)}`);
            logger.warn('Falling back to in-memory database backend');
            return new MemoryBackend();
        }
    }

    // Utility methods
    async getInfo(): Promise<{
        cache: { type: string; connected: boolean };
        database: { type: string; connected: boolean };
        connected: boolean;
    }> {
        return {
            cache: {
                type: this.cache?.getBackendType() || 'none',
                connected: this.cache?.isConnected() || false,
            },
            database: {
                type: this.database?.getBackendType() || 'none',
                connected: this.database?.isConnected() || false,
            },
            connected: this.connected,
        };
    }

    // Health check
    async healthCheck(): Promise<{
        cache: boolean;
        database: boolean;
        overall: boolean;
    }> {
        let cacheHealthy = false;
        let databaseHealthy = false;

        try {
            if (this.cache?.isConnected()) {
                await this.cache.set(HEALTH_CHECK_KEY, 'ok', 10);
                const result = await this.cache.get(HEALTH_CHECK_KEY);
                cacheHealthy = result === 'ok';
                await this.cache.delete(HEALTH_CHECK_KEY);
            }
        } catch (error) {
            logger.warn('Cache health check failed:', error);
        }

        try {
            if (this.database?.isConnected()) {
                await this.database.set(HEALTH_CHECK_KEY, 'ok');
                const result = await this.database.get(HEALTH_CHECK_KEY);
                databaseHealthy = result === 'ok';
                await this.database.delete(HEALTH_CHECK_KEY);
            }
        } catch (error) {
            logger.warn('Database health check failed:', error);
        }

        return {
            cache: cacheHealthy,
            database: databaseHealthy,
            overall: cacheHealthy && databaseHealthy,
        };
    }
}

/**
 * Create storage backends without using singleton pattern
 * This allows multiple agent instances to have independent storage
 */
export async function createStorageBackends(config: ValidatedStorageConfig): Promise<{
    manager: StorageManager;
    backends: StorageBackends;
}> {
    const manager = new StorageManager(config);
    const backends = await manager.connect();
    return { manager, backends };
}
