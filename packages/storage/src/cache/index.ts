/**
 * Cache Module
 *
 * This module provides a flexible caching system with support for
 * multiple concrete backends.
 *
 * ## Usage
 * Cache backends are typically constructed by an image's storage implementation after validating
 * config with the matching schema.
 */

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
export { RedisStore } from './redis-store.js';
