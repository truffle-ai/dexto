import type { BlobStore } from './types.js';
import type { Logger } from '@dexto/core';
import type { z } from 'zod';

/**
 * Factory interface for creating blob store instances.
 *
 * Factories are plain exports (no global registries). Images decide which factories are
 * available by including them in `image.storage.blob`.
 */
export interface BlobStoreFactory<TConfig = unknown> {
    /**
     * Zod schema for validating factory-specific configuration.
     * The schema must output the `TConfig` type.
     */
    configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;

    /**
     * Factory function to create a BlobStore instance.
     * @param config - Validated configuration specific to this backend
     * @param logger - Logger instance for the blob store
     * @returns A BlobStore implementation
     */
    create(config: TConfig, logger: Logger): BlobStore | Promise<BlobStore>;

    /**
     * Optional metadata for documentation, UIs, and discovery.
     */
    metadata?: {
        /** Human-readable name (e.g., "Local Filesystem", "Amazon S3") */
        displayName: string;
        /** Brief description of this storage backend */
        description: string;
        /** Whether this backend requires network connectivity */
        requiresNetwork?: boolean;
    };
}
