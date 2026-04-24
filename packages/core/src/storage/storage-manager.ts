import type { Cache } from './cache/types.js';
import type { Database } from './database/types.js';
import type { BlobStore } from './blob/types.js';
import { StorageError } from './errors.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { DatabaseBackedDextoStores } from './stores/database-backed.js';
import type { DextoStoreMap, DextoStoreName, DextoStores } from './stores/types.js';

const HEALTH_CHECK_KEY = 'storage_manager_health_check';

/**
 * Storage manager that initializes and manages storage backends.
 * Handles typed runtime stores with temporary access to low-level backends while callers migrate.
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
    private stores: DextoStores;
    private initialized = true;
    private connected = false;
    private logger: Logger;

    constructor(backends: StorageBackends, logger: Logger) {
        this.cache = backends.cache;
        this.database = backends.database;
        this.blobStore = backends.blobStore;
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
        this.stores = new DatabaseBackedDextoStores(backends, this.logger);
    }

    /**
     * Initialize storage instances without connecting.
     * Kept for call-site compatibility; backends are provided at construction time.
     */
    async initialize(): Promise<void> {
        this.initialized = true;
    }

    /**
     * Connect all storage backends.
     * Must call initialize() first.
     */
    async connect(): Promise<void> {
        if (!this.initialized) {
            throw StorageError.managerNotInitialized('connect');
        }

        if (this.connected) {
            return;
        }

        try {
            await this.stores.connect();
            this.connected = true;
        } catch (error) {
            await this.rollbackConnectionFailure();
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        await this.stores.disconnect();
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected && this.stores.isConnected();
    }

    getStore<K extends DextoStoreName>(name: K): DextoStoreMap[K] {
        if (!this.connected) {
            throw StorageError.managerNotConnected('getStore');
        }
        return this.stores.getStore(name);
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

    private async rollbackConnectionFailure(): Promise<void> {
        this.logger.warn('Storage connection failed, rolling back connected stores');
        const results = await Promise.allSettled([
            this.cache.isConnected() ? this.cache.disconnect() : Promise.resolve(),
            this.database.isConnected() ? this.database.disconnect() : Promise.resolve(),
            this.blobStore.isConnected() ? this.blobStore.disconnect() : Promise.resolve(),
        ]);

        for (const result of results) {
            if (result.status === 'rejected') {
                this.logger.error(
                    `Failed to rollback storage connection: ${String(result.reason)}`
                );
            }
        }
    }
}
