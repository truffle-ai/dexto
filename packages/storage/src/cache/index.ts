/**
 * Cache Module
 *
 * This module provides a flexible caching system with support for
 * multiple backends through a factory pattern.
 *
 * ## Built-in Factories
 * - `in-memory`: Store data in RAM (for testing/development)
 * - `redis`: Store data in Redis server
 *
 * ## Custom Factories
 * Image implementations decide which factories to use inside their `storage.createStores`
 * implementation.
 *
 * ## Usage
 * Cache backends are typically constructed by an image's storage implementation. For direct usage,
 * call a factory's `create()` after validating config with its `configSchema`.
 */

// Export public API
export type { CacheFactory } from './factory.js';

// Export types and interfaces
export type { Cache } from './types.js';

// Export built-in factories (plain exports; no registries)
export { inMemoryCacheFactory, redisCacheFactory } from './factories/index.js';

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
