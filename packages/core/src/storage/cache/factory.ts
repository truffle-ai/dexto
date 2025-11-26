import type { Cache } from './types.js';
import type { RedisCacheConfig, CacheConfig } from '../schemas.js';
import { MemoryCacheStore } from './memory-cache-store.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { StorageError } from '../errors.js';

// Type for Redis store constructor
interface RedisStoreConstructor {
    new (config: RedisCacheConfig, logger: IDextoLogger): Cache;
}

// Lazy import for optional Redis dependency
let RedisStore: RedisStoreConstructor | null = null;

/**
 * Create a cache store based on configuration.
 * Handles lazy loading of optional dependencies.
 * Throws StorageError.dependencyNotInstalled if required package is missing.
 * @param config Cache configuration
 * @param logger Logger instance for logging
 */
export async function createCache(config: CacheConfig, logger: IDextoLogger): Promise<Cache> {
    switch (config.type) {
        case 'redis':
            return createRedisStore(config, logger);

        case 'in-memory':
        default:
            logger.info('Using in-memory cache store');
            return new MemoryCacheStore();
    }
}

async function createRedisStore(config: RedisCacheConfig, logger: IDextoLogger): Promise<Cache> {
    try {
        if (!RedisStore) {
            const module = await import('./redis-store.js');
            RedisStore = module.RedisStore;
        }
        logger.info(`Connecting to Redis at ${config.host}:${config.port}`);
        return new RedisStore(config, logger);
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ERR_MODULE_NOT_FOUND') {
            throw StorageError.dependencyNotInstalled('Redis', 'ioredis', 'npm install ioredis');
        }
        throw error;
    }
}
