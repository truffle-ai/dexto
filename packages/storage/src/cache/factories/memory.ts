import type { InMemoryCacheConfig } from '../schemas.js';
import { InMemoryCacheSchema } from '../schemas.js';
import { MemoryCacheStore } from '../memory-cache-store.js';
import type { CacheFactory } from '../factory.js';

/**
 * Factory for in-memory cache storage.
 *
 * This factory stores data in RAM and is ideal for development,
 * testing, and ephemeral use cases where persistence is not required.
 *
 * Features:
 * - Zero external dependencies
 * - Fast in-memory operations
 * - TTL support for automatic expiration
 * - No network required
 * - Data is lost on restart
 */
export const inMemoryCacheFactory: CacheFactory<InMemoryCacheConfig> = {
    configSchema: InMemoryCacheSchema,
    create: (_config, _logger) => new MemoryCacheStore(),
    metadata: {
        displayName: 'In-Memory',
        description: 'Store cache data in RAM (ephemeral, for testing and development)',
        requiresNetwork: false,
        supportsTTL: true,
    },
};
