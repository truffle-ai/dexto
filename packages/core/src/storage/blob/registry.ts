import type { BlobStoreProvider } from './provider.js';
import { StorageError } from '../errors.js';
import { BaseRegistry, type RegistryErrorFactory } from '../../providers/base-registry.js';

/**
 * Error factory for blob store registry errors.
 * Uses StorageError for consistent error handling.
 */
const blobStoreErrorFactory: RegistryErrorFactory = {
    alreadyRegistered: (type: string) => StorageError.blobProviderAlreadyRegistered(type),
    notFound: (type: string, availableTypes: string[]) =>
        StorageError.unknownBlobProvider(type, availableTypes),
};

/**
 * Registry for blob store providers.
 *
 * This registry manages available blob store implementations and provides
 * runtime validation for configurations. Providers can be registered from
 * both core (built-in) and application layers (custom).
 *
 * The registry follows a global singleton pattern to allow registration
 * before configuration loading, while maintaining type safety through
 * provider interfaces.
 *
 * Extends BaseRegistry for common registry functionality.
 */
export class BlobStoreRegistry extends BaseRegistry<BlobStoreProvider<any, any>> {
    constructor() {
        super(blobStoreErrorFactory);
    }

    /**
     * Get all registered providers.
     * Alias for getAll() for backward compatibility.
     *
     * @returns Array of providers
     */
    getProviders(): BlobStoreProvider<any, any>[] {
        return this.getAll();
    }
}

/**
 * Global singleton registry for blob store providers.
 *
 * This registry is used by the createBlobStore factory and can be extended
 * with custom providers before configuration loading.
 *
 * Example usage in CLI/server layer:
 * ```typescript
 * import { blobStoreRegistry } from '@dexto/core';
 * import { s3Provider } from './storage/s3-provider.js';
 *
 * // Register custom provider before loading config
 * blobStoreRegistry.register(s3Provider);
 * ```
 */
export const blobStoreRegistry = new BlobStoreRegistry();
