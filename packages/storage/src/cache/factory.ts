import type { Cache } from './types.js';
import type { Logger } from '@dexto/core';
import type { z } from 'zod';

/**
 * Factory interface for creating cache instances.
 *
 * Factories are plain exports (no global registries). Images decide which factories are
 * available by including them in `image.storage.cache`.
 */
export interface CacheFactory<TConfig = unknown> {
    /**
     * Zod schema for validating factory-specific configuration.
     * The schema must output the `TConfig` type.
     */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;

    /**
     * Factory function to create a Cache instance.
     *
     * Cache factories may return a Promise to support lazy loading of optional
     * dependencies (e.g., `ioredis`).
     *
     * @param config - Validated configuration specific to this backend
     * @param logger - Logger instance for the cache
     * @returns A Cache implementation (or Promise for async backends)
     */
    create(config: TConfig, logger: Logger): Cache | Promise<Cache>;

    /**
     * Optional metadata for documentation, UIs, and discovery.
     */
    metadata?: {
        /** Human-readable name (e.g., "Redis", "Memcached") */
        displayName: string;
        /** Brief description of this cache backend */
        description: string;
        /** Whether this backend requires network connectivity */
        requiresNetwork?: boolean;
        /** Whether this backend supports TTL (time-to-live) */
        supportsTTL?: boolean;
    };
}
