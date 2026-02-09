import type { Cache } from './cache/types.js';
import type { Database } from './database/types.js';
import type { BlobStore } from './blob/types.js';
import type { ValidatedStorageConfig } from './schemas.js';
// Import factories from index files for consistent public surface
import { createCache } from './cache/index.js';
import { createDatabase } from './database/index.js';
import { createBlobStore } from './blob/index.js';
import { StorageError } from './errors.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';

const HEALTH_CHECK_KEY = 'storage_manager_health_check';

/**
 * Storage manager that initializes and manages storage backends.
 * Handles cache, database, and blob backends with automatic fallbacks.
 *
 * Lifecycle:
 * 1. new StorageManager({ cache, database, blobStore }) - Creates manager with concrete backends
 * 2. await manager.initialize() - No-op (kept for compatibility)
 * 3. await manager.connect() - Establishes connections to all stores
 * 4. await manager.disconnect() - Closes all connections
 */
export interface StorageBackends {
    cache: Cache;
    database: Database;
    blobStore: BlobStore;
}

export class StorageManager {
    private cache: Cache;
    private database: Database;
    private blobStore: BlobStore;
    private initialized = true;
    private connected = false;
    private logger: IDextoLogger;

    constructor(backends: StorageBackends, logger: IDextoLogger) {
        this.cache = backends.cache;
        this.database = backends.database;
        this.blobStore = backends.blobStore;
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    /**
     * Initialize storage instances without connecting.
     * Kept for call-site compatibility; backends are provided at construction time.
     */
    async initialize(): Promise<void> {
        // TODO: temporary glue code to be removed/verified
        // Backends are provided at construction time; keep initialize() for call-site compatibility.
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

        // Establish connections with rollback on partial failure
        const connected: ('cache' | 'database' | 'blob')[] = [];
        try {
            await this.cache.connect();
            connected.push('cache');

            await this.database.connect();
            connected.push('database');

            await this.blobStore.connect();
            connected.push('blob');

            this.connected = true;
        } catch (error) {
            // Rollback: disconnect any stores that were successfully connected
            this.logger.warn(
                `Storage connection failed, rolling back ${connected.length} connected stores`
            );
            for (const store of connected.reverse()) {
                try {
                    if (store === 'cache') await this.cache.disconnect();
                    else if (store === 'database') await this.database.disconnect();
                    else if (store === 'blob') await this.blobStore.disconnect();
                } catch (disconnectError) {
                    this.logger.error(
                        `Failed to rollback ${store} during connection failure: ${disconnectError}`
                    );
                }
            }
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        // Disconnect all stores concurrently, continue even if some fail
        const results = await Promise.allSettled([
            this.cache.disconnect(),
            this.database.disconnect(),
            this.blobStore.disconnect(),
        ]);

        // Track errors from failed disconnections
        const errors: Error[] = [];
        const storeNames = ['cache', 'database', 'blob store'];

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const storeName = storeNames[index];
                const error = result.reason;
                this.logger.error(`Failed to disconnect ${storeName}: ${error}`);
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
        });

        this.connected = false;

        // If any disconnections failed, throw an aggregated error
        if (errors.length > 0) {
            throw StorageError.connectionFailed(
                `Failed to disconnect ${errors.length} storage backend(s): ${errors.map((e) => e.message).join(', ')}`
            );
        }
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
            this.logger.warn(`Cache health check failed: ${error}`);
        }

        try {
            if (this.database.isConnected()) {
                await this.database.set(HEALTH_CHECK_KEY, 'ok');
                const result = await this.database.get(HEALTH_CHECK_KEY);
                databaseHealthy = result === 'ok';
                await this.database.delete(HEALTH_CHECK_KEY);
            }
        } catch (error) {
            this.logger.warn(`Database health check failed: ${error}`);
        }

        try {
            if (this.blobStore.isConnected()) {
                // For blob store, just check if it's connected (no data operations)
                blobHealthy = this.blobStore.isConnected();
            }
        } catch (error) {
            this.logger.warn(`Blob store health check failed: ${error}`);
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
 * Per-agent paths are provided via CLI enrichment layer before this point.
 * @param config Storage configuration with explicit paths
 */
export async function createStorageManager(
    config: ValidatedStorageConfig,
    logger: IDextoLogger
): Promise<StorageManager> {
    // TODO: temporary glue code to be removed/verified
    // In Phase 2, product layers resolve storage instances via images/resolver and call `new StorageManager()`.
    const storageLogger = logger.createChild(DextoLogComponent.STORAGE);
    const cache = await createCache(config.cache, storageLogger);
    const database = await createDatabase(config.database, storageLogger);
    const blobStore = createBlobStore(config.blob, storageLogger);

    const manager = new StorageManager({ cache, database, blobStore }, logger);
    await manager.initialize();
    await manager.connect();
    return manager;
}
