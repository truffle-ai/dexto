import type { BlobStore } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { blobStoreRegistry } from './registry.js';

/**
 * Create a blob store based on configuration using the provider registry.
 *
 * This factory function:
 * 1. Validates the configuration against the registered provider's schema
 * 2. Looks up the provider in the registry
 * 3. Calls the provider's create method to instantiate the blob store
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match a registered provider. Custom providers can be registered
 * via blobStoreRegistry.register() before calling this function.
 *
 * @param config - Blob store configuration with a 'type' discriminator
 * @param logger - Logger instance for the blob store
 * @returns A BlobStore implementation
 * @throws Error if the provider type is not registered or validation fails
 *
 * @example
 * ```typescript
 * // Using built-in provider
 * const blob = createBlobStore({ type: 'local', storePath: '/tmp/blobs' }, logger);
 *
 * // Using custom provider (registered beforehand)
 * import { blobStoreRegistry } from '@dexto/core';
 * import { s3Provider } from './storage/s3-provider.js';
 *
 * blobStoreRegistry.register(s3Provider);
 * const blob = createBlobStore({ type: 's3', bucket: 'my-bucket' }, logger);
 * ```
 */
export function createBlobStore(
    config: { type: string; [key: string]: any },
    logger: IDextoLogger
): BlobStore {
    // Validate config against provider schema and get provider
    const validatedConfig = blobStoreRegistry.validateConfig(config);
    const provider = blobStoreRegistry.get(validatedConfig.type);

    if (!provider) {
        // This should never happen after validateConfig, but handle it defensively
        throw new Error(`Provider '${validatedConfig.type}' not found in registry`);
    }

    // Log which provider is being used
    const providerName = provider.metadata?.displayName || validatedConfig.type;
    logger.info(`Using ${providerName} blob store`);

    // Create and return the blob store instance
    return provider.create(validatedConfig, logger);
}
