import type { Cache } from './types.js';
import type { IDextoLogger } from '@dexto/core';
import { StorageError } from '@dexto/core';
import { CACHE_TYPES, CacheConfigSchema } from './schemas.js';
import { inMemoryCacheProvider, redisCacheProvider } from './providers/index.js';

/**
 * Create a cache based on configuration.
 *
 * NOTE: This currently supports only core built-in providers. Custom providers are
 * resolved by the product-layer resolver (`@dexto/agent-config`) during the DI refactor.
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match an available provider.
 *
 * @param config - Cache configuration with a 'type' discriminator
 * @param logger - Logger instance for the cache
 * @returns A Cache implementation
 * @throws Error if validation fails or the provider type is unknown
 *
 * @example
 * ```typescript
 * // Using built-in provider
 * const cache = await createCache({ type: 'redis', host: 'localhost' }, logger);
 * ```
 */
export async function createCache(config: unknown, logger: IDextoLogger): Promise<Cache> {
    const parsedConfig = CacheConfigSchema.safeParse(config);
    if (!parsedConfig.success) {
        throw StorageError.cacheInvalidConfig(parsedConfig.error.message);
    }

    const type = parsedConfig.data.type;

    switch (type) {
        case 'in-memory': {
            logger.info('Using In-Memory cache');
            const validatedConfig = inMemoryCacheProvider.configSchema.parse(config);
            return await inMemoryCacheProvider.create(validatedConfig, logger);
        }
        case 'redis': {
            logger.info('Using Redis cache');
            const validatedConfig = redisCacheProvider.configSchema.parse(config);
            return await redisCacheProvider.create(validatedConfig, logger);
        }
        default:
            throw StorageError.unknownCacheProvider(type, [...CACHE_TYPES]);
    }
}
