import { Redis } from 'ioredis';
import type { CacheBackend } from './cache-backend.js';
import type { RedisBackendConfig } from '../schemas.js';
import { StorageError } from '../errors.js';

/**
 * Redis storage backend for production cache operations.
 * Implements the CacheBackend interface with connection pooling and optimizations.
 * EXPERIMENTAL - NOT FULLY TESTED YET
 */
export class RedisBackend implements CacheBackend {
    private redis: Redis | null = null;
    private connected = false;

    constructor(private config: RedisBackendConfig) {}

    async connect(): Promise<void> {
        if (this.connected) return;

        this.redis = new Redis({
            ...(this.config.host && { host: this.config.host }),
            ...(this.config.port && { port: this.config.port }),
            ...(this.config.password && { password: this.config.password }),
            db: this.config.database || 0,
            family: 4, // IPv4 by default
            ...(this.config.connectionTimeoutMillis && {
                connectTimeout: this.config.connectionTimeoutMillis,
            }),
            ...(this.config.connectionTimeoutMillis && {
                commandTimeout: this.config.connectionTimeoutMillis,
            }),
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            ...this.config.options,
        });

        // Set up error handling
        this.redis.on('error', (error) => {
            console.error('Redis connection error:', error);
        });

        this.redis.on('connect', () => {
            this.connected = true;
        });

        this.redis.on('close', () => {
            this.connected = false;
        });

        await this.redis.connect();
    }

    async disconnect(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected && this.redis?.status === 'ready';
    }

    getBackendType(): string {
        return 'redis';
    }

    // Core operations
    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        try {
            const value = await this.redis!.get(key);
            return value ? JSON.parse(value) : undefined;
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
            const serialized = JSON.stringify(value);

            if (ttlSeconds) {
                await this.redis!.setex(key, ttlSeconds, serialized);
            } else {
                await this.redis!.set(key, serialized);
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
        try {
            await this.redis!.del(key);
        } catch (error) {
            throw StorageError.deleteFailed(
                'delete',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    // Redis-specific optimizations
    async mget<T>(keys: string[]): Promise<(T | undefined)[]> {
        this.checkConnection();
        if (keys.length === 0) return [];

        const values = await this.redis!.mget(...keys);
        return values.map((value) => (value ? JSON.parse(value) : undefined));
    }

    async mset<T>(entries: [string, T][]): Promise<void> {
        this.checkConnection();
        if (entries.length === 0) return;

        const pipeline = this.redis!.pipeline();
        for (const [key, value] of entries) {
            pipeline.set(key, JSON.stringify(value));
        }
        await pipeline.exec();
    }

    async exists(key: string): Promise<boolean> {
        this.checkConnection();
        const result = await this.redis!.exists(key);
        return result === 1;
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        this.checkConnection();
        await this.redis!.expire(key, ttlSeconds);
    }

    // Cache-specific operations
    async increment(key: string, by: number = 1): Promise<number> {
        this.checkConnection();
        return await this.redis!.incrby(key, by);
    }

    async decrement(key: string, by: number = 1): Promise<number> {
        this.checkConnection();
        return await this.redis!.decrby(key, by);
    }

    // List operations (for compatibility with DatabaseBackend patterns)
    async append<T>(key: string, item: T): Promise<void> {
        this.checkConnection();
        await this.redis!.rpush(key, JSON.stringify(item));
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        this.checkConnection();
        const items = await this.redis!.lrange(key, start, start + count - 1);
        return items.map((item) => JSON.parse(item));
    }

    async list(prefix: string): Promise<string[]> {
        this.checkConnection();
        return await this.redis!.keys(`${prefix}*`);
    }

    private checkConnection(): void {
        if (!this.connected || !this.redis || this.redis.status !== 'ready') {
            throw StorageError.notConnected('RedisBackend');
        }
    }

    // Maintenance operations
    async flushdb(): Promise<void> {
        this.checkConnection();
        await this.redis!.flushdb();
    }

    async info(): Promise<string> {
        this.checkConnection();
        return await this.redis!.info();
    }
}
