import type { Database } from './types.js';
import { StorageError } from '@dexto/core';

/**
 * In-memory database store for development and testing.
 * Supports list operations for message history and enumeration for settings.
 * Data is lost when the process restarts.
 */
export class MemoryDatabaseStore implements Database {
    private data = new Map<string, unknown>();
    private lists = new Map<string, unknown[]>();
    private connected = false;

    constructor() {}

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.data.clear();
        this.lists.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }

    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        try {
            return this.data.get(key) as T | undefined;
        } catch (error) {
            throw StorageError.readFailed(
                'get',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.checkConnection();
        try {
            this.data.set(key, value);
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
    }

    async list(prefix: string): Promise<string[]> {
        this.checkConnection();
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
        return list.slice(start, start + count) as T[];
    }

    // Helper methods
    private checkConnection(): void {
        if (!this.connected) {
            throw StorageError.notConnected('MemoryDatabaseStore');
        }
    }

    // Development helpers
    async clear(): Promise<void> {
        this.data.clear();
        this.lists.clear();
    }

    async dump(): Promise<{ data: Record<string, unknown>; lists: Record<string, unknown[]> }> {
        return {
            data: Object.fromEntries(this.data.entries()),
            lists: Object.fromEntries(this.lists.entries()),
        };
    }
}
