import type { Cache } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { cacheRegistry } from './registry.js';

/**
 * Create a cache based on configuration using the provider registry.
 *
 * This factory function:
 * 1. Validates the configuration against the registered provider's schema
 * 2. Looks up the provider in the registry
 * 3. Calls the provider's create method to instantiate the cache
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match a registered provider. Custom providers can be registered
 * via cacheRegistry.register() before calling this function.
 *
 * @param config - Cache configuration with a 'type' discriminator
 * @param logger - Logger instance for the cache
 * @returns A Cache implementation
 * @throws Error if the provider type is not registered or validation fails
 *
 * @example
 * ```typescript
 * // Using built-in provider
 * const cache = await createCache({ type: 'redis', host: 'localhost' }, logger);
 *
 * // Using custom provider (registered beforehand)
 * import { cacheRegistry } from '@dexto/core';
 * import { memcachedProvider } from './storage/memcached-provider.js';
 *
 * cacheRegistry.register(memcachedProvider);
 * const cache = await createCache({ type: 'memcached', servers: ['...'] }, logger);
 * ```
 */
export async function createCache(
    config: { type: string; [key: string]: any },
    logger: IDextoLogger
): Promise<Cache> {
    // Validate config against provider schema and get provider
    const validatedConfig = cacheRegistry.validateConfig(config);
    const provider = cacheRegistry.get(validatedConfig.type);

    if (!provider) {
        // This should never happen after validateConfig, but handle it defensively
        throw new Error(`Provider '${validatedConfig.type}' not found in registry`);
    }

    // Log which provider is being used
    const providerName = provider.metadata?.displayName || validatedConfig.type;
    logger.info(`Using ${providerName} cache`);

    // Create and return the cache instance (may be async for lazy-loaded dependencies)
    return provider.create(validatedConfig, logger);
}
