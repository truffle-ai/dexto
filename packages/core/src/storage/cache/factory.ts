import type { Cache } from './types.js';
import type { RedisCacheConfig, CacheConfig } from '../schemas.js';
import { MemoryCacheStore } from './memory-cache-store.js';
import { logger } from '../../logger/index.js';

// Type for Redis store constructor
interface RedisStoreConstructor {
    new (config: RedisCacheConfig): Cache;
}

// Lazy import for optional Redis dependency
let RedisStore: RedisStoreConstructor | null = null;

/**
 * Create a cache store based on configuration.
 * Handles lazy loading of optional dependencies with automatic fallback.
 */
export async function createCache(config: CacheConfig): Promise<Cache> {
    switch (config.type) {
        case 'redis':
            return createRedisStore(config);

        case 'in-memory':
        default:
            logger.info('Using in-memory cache store');
            return new MemoryCacheStore();
    }
}

async function createRedisStore(config: RedisCacheConfig): Promise<Cache> {
    try {
        if (!RedisStore) {
            const module = await import('./redis-store.js');
            RedisStore = module.RedisStore;
        }
        logger.info(`Connecting to Redis at ${config.host}:${config.port}`);
        return new RedisStore(config);
    } catch (error) {
        logger.warn(`Redis not available, falling back to in-memory cache: ${error}`);
        return new MemoryCacheStore();
    }
}
