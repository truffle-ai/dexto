import type { Cache } from './cache/types.js';
import type { Database } from './database/types.js';
import type { BlobStore } from './blob/types.js';
import type { ValidatedStorageConfig } from './schemas.js';
import { createCache } from './cache/factory.js';
import { createDatabase } from './database/factory.js';
import { createBlobStore } from './blob/factory.js';
import { StorageError } from './errors.js';
import { logger } from '../logger/index.js';

const HEALTH_CHECK_KEY = 'storage_manager_health_check';

/**
 * Storage manager that initializes and manages storage backends.
 * Handles cache, database, and blob backends with automatic fallbacks.
 *
 * Lifecycle:
 * 1. new StorageManager(config) - Creates manager with config
 * 2. await manager.initialize() - Creates store instances (without connecting)
 * 3. await manager.connect() - Establishes connections to all stores
 * 4. await manager.disconnect() - Closes all connections
 */
export class StorageManager {
    private config: ValidatedStorageConfig;
    private cache!: Cache;
    private database!: Database;
    private blobStore!: BlobStore;
    private initialized = false;
    private connected = false;

    constructor(config: ValidatedStorageConfig) {
        this.config = config;
    }

    /**
     * Initialize storage instances without connecting.
     * This allows configuration and inspection before establishing connections.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Create store instances
        this.cache = await createCache(this.config.cache);
        this.database = await createDatabase(this.config.database);
        this.blobStore = createBlobStore(this.config.blob);

        this.initialized = true;
    }

    /**
     * Connect all storage backends.
     * Must call initialize() first, or use createStorageManager() helper.
     */
    async connect(): Promise<void> {
        if (!this.initialized) {
            throw StorageError.managerNotInitialized('connect');
        }

        if (this.connected) {
            return;
        }

        // Establish connections
        await this.cache.connect();
        await this.database.connect();
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
     * @throws {DextoRuntimeError} if not connected
     */
    getCache(): Cache {
        if (!this.connected) {
            throw StorageError.managerNotConnected('getCache');
        }
        return this.cache;
    }

    /**
     * Get the database store instance.
     * @throws {DextoRuntimeError} if not connected
     */
    getDatabase(): Database {
        if (!this.connected) {
            throw StorageError.managerNotConnected('getDatabase');
        }
        return this.database;
    }

    /**
     * Get the blob store instance.
     * @throws {DextoRuntimeError} if not connected
     */
    getBlobStore(): BlobStore {
        if (!this.connected) {
            throw StorageError.managerNotConnected('getBlobStore');
        }
        return this.blobStore;
    }

    // Utility methods
    async getInfo(): Promise<{
        cache: { type: string; connected: boolean };
        database: { type: string; connected: boolean };
        blob: { type: string; connected: boolean };
        connected: boolean;
    }> {
        if (!this.connected) {
            throw StorageError.managerNotConnected('getInfo');
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
            throw StorageError.managerNotConnected('healthCheck');
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
 * This is a convenience helper that combines initialization and connection.
 * This allows multiple agent instances to have independent storage.
 */
export async function createStorageManager(
    config: ValidatedStorageConfig
): Promise<StorageManager> {
    const manager = new StorageManager(config);
    await manager.initialize();
    await manager.connect();
    return manager;
}
