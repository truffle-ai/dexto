import type { z } from 'zod';
import type { BlobStore } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

/**
 * Provider interface for creating blob store instances.
 *
 * This interface uses TypeScript generics to enforce type safety:
 * - TType: The literal type string (e.g., 'local', 's3')
 * - TConfig: The configuration type with discriminator { type: TType }
 *
 * This ensures that the provider type matches the config type discriminator,
 * providing compile-time safety for provider implementations.
 */
export interface BlobStoreProvider<
    TType extends string = string,
    TConfig extends { type: TType } = any,
> {
    /**
     * Unique identifier for this provider (e.g., 'local', 'supabase', 's3').
     * Must match the 'type' field in the configuration.
     */
    type: TType;

    /**
     * Zod schema for validating provider-specific configuration.
     * The schema must output TConfig type.
     *
     * Note: Uses z.ZodType with relaxed generics to allow input/output type variance.
     * This is necessary because Zod schemas with `.optional().default()` have
     * input types that include undefined, but output types that don't.
     */
    configSchema: z.ZodType<TConfig, any, any>;

    /**
     * Factory function to create a BlobStore instance.
     * @param config - Validated configuration specific to this provider
     * @param logger - Logger instance for the blob store
     * @returns A BlobStore implementation
     */
    create(config: TConfig, logger: IDextoLogger): BlobStore;

    /**
     * Optional metadata for documentation, UIs, and discovery.
     */
    metadata?: {
        /** Human-readable name (e.g., "Local Filesystem", "Amazon S3") */
        displayName: string;
        /** Brief description of this storage backend */
        description: string;
        /** Whether this provider requires network connectivity */
        requiresNetwork?: boolean;
    };
}
