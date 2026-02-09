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
 * During the DI refactor, custom providers are resolved by product layers (CLI/server/platform)
 * via typed image factories (`@dexto/agent-config`), not via core registries.
 *
 * ## Usage
 *
 * ### Using built-in providers
 * ```typescript
 * import { createCache } from '@dexto/core';
 *
 * const cache = await createCache({ type: 'redis', host: 'localhost' }, logger);
 * ```
 */

// Export public API
export { createCache } from './factory.js';
export type { CacheProvider } from './provider.js';

// Export types and interfaces
export type { Cache } from './types.js';

// Export built-in providers (plain exports; no auto-registration)
export { inMemoryCacheProvider, redisCacheProvider } from './providers/index.js';

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
