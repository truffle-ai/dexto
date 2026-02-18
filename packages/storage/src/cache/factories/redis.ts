import type { RedisCacheConfig } from '../schemas.js';
import { RedisCacheSchema } from '../schemas.js';
import { StorageError } from '@dexto/core';
import type { CacheFactory } from '../factory.js';

/**
 * Factory for Redis cache storage.
 *
 * This factory stores data in a Redis server using the ioredis package.
 * It's ideal for production deployments requiring scalability, persistence,
 * and multi-machine access.
 *
 * Features:
 * - Native TTL support
 * - Connection pooling
 * - Pub/sub capabilities (via additional methods)
 * - Suitable for distributed deployments
 *
 * Note: ioredis is an optional dependency. Install it with:
 * bun add ioredis
 */
export const redisCacheFactory: CacheFactory<RedisCacheConfig> = {
    configSchema: RedisCacheSchema,
    create: async (config, logger) => {
        try {
            const module = await import('../redis-store.js');
            logger.info(`Connecting to Redis at ${config.host || config.url}`);
            return new module.RedisStore(config, logger);
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ERR_MODULE_NOT_FOUND') {
                throw StorageError.dependencyNotInstalled('Redis', 'ioredis', 'bun add ioredis');
            }
            throw error;
        }
    },
    metadata: {
        displayName: 'Redis',
        description: 'Production Redis cache with TTL and pub/sub support',
        requiresNetwork: true,
        supportsTTL: true,
    },
};
