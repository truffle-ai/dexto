import type { CacheProvider } from './provider.js';
import { StorageError } from '../errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../../providers/base-registry.js';

/**
 * Error factory for cache registry errors.
 * Uses StorageError for consistent error handling.
 */
const cacheErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => StorageError.cacheProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        StorageError.unknownCacheProvider(type, availableTypes),
};

/**
 * Registry for cache providers.
 *
 * This registry manages available cache implementations and provides
 * runtime validation for configurations. Providers can be registered from
 * both core (built-in) and application layers (custom).
 *
 * The registry follows a global singleton pattern to allow registration
 * before configuration loading, while maintaining type safety through
 * provider interfaces.
 *
 * Extends BaseRegistry for common registry functionality.
 */
export class CacheRegistry extends BaseRegistry<CacheProvider<any, any>> {
    constructor() {
        super(cacheErrorFactory);
    }

    /**
     * Get all registered providers.
     * Alias for getAll() for backward compatibility.
     *
     * @returns Array of providers
     */
    getProviders(): CacheProvider<any, any>[] {
        return this.getAll();
    }
}

/**
 * Global singleton registry for cache providers.
 *
 * This registry is used by the createCache factory and can be extended
 * with custom providers before configuration loading.
 *
 * Example usage in CLI/server layer:
 * ```typescript
 * import { cacheRegistry } from '@dexto/core';
 * import { memcachedProvider } from './storage/memcached-provider.js';
 *
 * // Register custom provider before loading config
 * cacheRegistry.register(memcachedProvider);
 * ```
 */
export const cacheRegistry = new CacheRegistry();
