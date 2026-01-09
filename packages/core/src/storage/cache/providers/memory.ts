import type { CacheProvider } from '../provider.js';
import type { InMemoryCacheConfig } from '../schemas.js';
import { InMemoryCacheSchema } from '../schemas.js';
import { MemoryCacheStore } from '../memory-cache-store.js';

/**
 * Provider for in-memory cache storage.
 *
 * This provider stores data in RAM and is ideal for development,
 * testing, and ephemeral use cases where persistence is not required.
 *
 * Features:
 * - Zero external dependencies
 * - Fast in-memory operations
 * - TTL support for automatic expiration
 * - No network required
 * - Data is lost on restart
 */
export const inMemoryCacheProvider: CacheProvider<'in-memory', InMemoryCacheConfig> = {
    type: 'in-memory',
    configSchema: InMemoryCacheSchema,
    create: (_config, _logger) => new MemoryCacheStore(),
    metadata: {
        displayName: 'In-Memory',
        description: 'Store cache data in RAM (ephemeral, for testing and development)',
        requiresNetwork: false,
        supportsTTL: true,
    },
};
