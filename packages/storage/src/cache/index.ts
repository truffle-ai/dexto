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
 * Product layers (CLI/server/platform) decide which factories are available by including them
 * in images (`DextoImage.storage.cache`).
 *
 * ## Usage
 * Cache backends are typically constructed by the product-layer resolver (`@dexto/agent-config`)
 * via image-provided factory maps. For direct usage, call a factory's `create()` after validating
 * config with its `configSchema`.
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
