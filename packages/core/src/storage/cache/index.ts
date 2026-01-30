/**
 * Cache Module
 *
 * This module provides a flexible caching system with support for
 * multiple backends through a provider pattern.
 *
 * ## Built-in Providers
 * - `in-memory`: Store data in RAM (for testing/development)
 * - `redis`: Store data in Redis server
 *
 * ## Custom Providers
 * Custom providers (e.g., Memcached, Hazelcast) can be registered at the
 * CLI/server layer before configuration loading.
 *
 * ## Usage
 *
 * ### Using built-in providers
 * ```typescript
 * import { createCache } from '@dexto/core';
 *
 * const cache = await createCache({ type: 'redis', host: 'localhost' }, logger);
 * ```
 *
 * ### Registering custom providers
 * ```typescript
 * import { cacheRegistry, type CacheProvider } from '@dexto/core';
 *
 * const memcachedProvider: CacheProvider<'memcached', MemcachedConfig> = {
 *   type: 'memcached',
 *   configSchema: MemcachedConfigSchema,
 *   create: (config, logger) => new MemcachedCache(config, logger),
 * };
 *
 * cacheRegistry.register(memcachedProvider);
 * const cache = await createCache({ type: 'memcached', servers: ['...'] }, logger);
 * ```
 */

// Import built-in providers
import { cacheRegistry } from './registry.js';
import { inMemoryCacheProvider, redisCacheProvider } from './providers/index.js';

// Register built-in providers on module load
// This ensures they're available when importing from @dexto/core
// Guard against duplicate registration when module is imported multiple times
if (!cacheRegistry.has('in-memory')) {
    cacheRegistry.register(inMemoryCacheProvider);
}
if (!cacheRegistry.has('redis')) {
    cacheRegistry.register(redisCacheProvider);
}

// Export public API
export { createCache } from './factory.js';
export { cacheRegistry, CacheRegistry } from './registry.js';
export type { CacheProvider } from './provider.js';

// Export types and interfaces
export type { Cache } from './types.js';

// Export schemas and config types
export {
    CACHE_TYPES,
    CacheConfigSchema,
    InMemoryCacheSchema,
    RedisCacheSchema,
    type CacheType,
    type CacheConfig,
    type InMemoryCacheConfig,
    type RedisCacheConfig,
} from './schemas.js';

// Export concrete implementations (for custom usage and external providers)
export { MemoryCacheStore } from './memory-cache-store.js';
