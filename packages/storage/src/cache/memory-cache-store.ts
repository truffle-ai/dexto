import type { Cache } from './types.js';
import { StorageError } from '@dexto/core';

/**
 * In-memory cache store for development and testing.
 * Supports TTL for automatic cleanup of temporary data.
 * Data is lost when the process restarts.
 */
export class MemoryCacheStore implements Cache {
    private data = new Map<string, any>();
    private ttls = new Map<string, number>();
    private connected = false;

    constructor() {}

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.data.clear();
        this.ttls.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'memory';
    }

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
        this.ttls.delete(key);
    }

    // Helper methods
    private checkConnection(): void {
        if (!this.connected) {
            throw StorageError.notConnected('MemoryCacheStore');
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
        this.ttls.clear();
    }

    async dump(): Promise<{ data: Record<string, any> }> {
        return {
            data: Object.fromEntries(this.data.entries()),
        };
    }
}
