import type { CacheBackend } from './cache-backend.js';
import type { DatabaseBackend } from './database-backend.js';
import { StorageError } from '../errors.js';

/**
 * In-memory storage backend for development and testing.
 * Implements both CacheBackend and DatabaseBackend interfaces.
 * Data is lost when the process restarts.
 */
export class MemoryBackend implements CacheBackend, DatabaseBackend {
    private data = new Map<string, any>();
    private lists = new Map<string, any[]>();
    private ttls = new Map<string, number>();
    private connected = false;

    constructor() {}

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.data.clear();
        this.lists.clear();
        this.ttls.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getBackendType(): string {
        return 'memory';
    }

    // Core operations
    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        try {
            this.checkTTL(key);
            return this.data.get(key);
        } catch (error) {
            throw StorageError.readFailed(
                'get',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        this.checkConnection();
        try {
            this.data.set(key, value);

            if (ttlSeconds) {
                this.ttls.set(key, Date.now() + ttlSeconds * 1000);
            } else {
                this.ttls.delete(key);
            }
        } catch (error) {
            throw StorageError.writeFailed(
                'set',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async delete(key: string): Promise<void> {
        this.checkConnection();
        this.data.delete(key);
        this.lists.delete(key);
        this.ttls.delete(key);
    }

    // List operations (DatabaseBackend)
    async list(prefix: string): Promise<string[]> {
        const keys: string[] = [];

        // Search in regular data
        for (const key of Array.from(this.data.keys())) {
            if (key.startsWith(prefix)) {
                keys.push(key);
            }
        }

        // Search in list data
        for (const key of Array.from(this.lists.keys())) {
            if (key.startsWith(prefix)) {
                keys.push(key);
            }
        }

        // Return unique sorted keys
        return Array.from(new Set(keys)).sort();
    }

    async append<T>(key: string, item: T): Promise<void> {
        this.checkConnection();
        if (!this.lists.has(key)) {
            this.lists.set(key, []);
        }
        this.lists.get(key)!.push(item);
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        this.checkConnection();
        const list = this.lists.get(key) || [];
        return list.slice(start, start + count);
    }

    // Helper methods
    private checkConnection(): void {
        if (!this.connected) {
            throw StorageError.notConnected('MemoryBackend');
        }
    }

    private checkTTL(key: string): void {
        const expiry = this.ttls.get(key);
        if (expiry && Date.now() > expiry) {
            this.data.delete(key);
            this.ttls.delete(key);
        }
    }

    // Development helpers
    async clear(): Promise<void> {
        this.data.clear();
        this.lists.clear();
        this.ttls.clear();
    }

    async dump(): Promise<{ data: Record<string, any>; lists: Record<string, any[]> }> {
        return {
            data: Object.fromEntries(this.data.entries()),
            lists: Object.fromEntries(this.lists.entries()),
        };
    }
}
