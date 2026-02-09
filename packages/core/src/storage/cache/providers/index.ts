/**
 * Built-in cache providers.
 *
 * During the DI refactor, custom providers are resolved by product layers (CLI/server/platform)
 * via typed image factories (`@dexto/agent-config`), not via core registries.
 */

export { inMemoryCacheProvider } from './memory.js';
export { redisCacheProvider } from './redis.js';
