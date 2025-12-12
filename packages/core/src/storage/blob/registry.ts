import { z } from 'zod';
import type { BlobStoreProvider } from './provider.js';

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
 */
export class BlobStoreRegistry {
    private providers = new Map<string, BlobStoreProvider<any, any>>();

    /**
     * Register a blob store provider.
     *
     * @param provider - The provider to register
     * @throws Error if a provider with the same type is already registered
     */
    register<TType extends string, TConfig extends { type: TType }>(
        provider: BlobStoreProvider<TType, TConfig>
    ): void {
        if (this.providers.has(provider.type)) {
            throw new Error(
                `Blob store provider '${provider.type}' is already registered. ` +
                    `Use unregister() first if you need to replace it.`
            );
        }
        this.providers.set(provider.type, provider);
    }

    /**
     * Unregister a blob store provider.
     *
     * @param type - The provider type to unregister
     * @returns true if the provider was unregistered, false if it wasn't registered
     */
    unregister(type: string): boolean {
        return this.providers.delete(type);
    }

    /**
     * Get a registered provider by type.
     *
     * @param type - The provider type identifier
     * @returns The provider if found, undefined otherwise
     */
    get(type: string): BlobStoreProvider<any, any> | undefined {
        return this.providers.get(type);
    }

    /**
     * Check if a provider is registered.
     *
     * @param type - The provider type identifier
     * @returns true if registered, false otherwise
     */
    has(type: string): boolean {
        return this.providers.has(type);
    }

    /**
     * Get all registered provider types.
     *
     * @returns Array of provider type identifiers
     */
    getTypes(): string[] {
        return Array.from(this.providers.keys());
    }

    /**
     * Get all registered providers.
     *
     * @returns Array of providers
     */
    getProviders(): BlobStoreProvider<any, any>[] {
        return Array.from(this.providers.values());
    }

    /**
     * Validate a configuration against its provider's schema.
     *
     * This method:
     * 1. Extracts the 'type' field to identify the provider
     * 2. Looks up the provider in the registry
     * 3. Validates the full config against the provider's schema
     * 4. Returns the validated, typed configuration
     *
     * @param config - Raw configuration object with a 'type' field
     * @returns Validated configuration object
     * @throws Error if type is missing, provider not found, or validation fails
     */
    validateConfig(config: unknown): any {
        // First, validate that we have a type field
        const typeSchema = z.object({ type: z.string() }).passthrough();
        const parsed = typeSchema.parse(config);

        // Look up the provider
        const provider = this.providers.get(parsed.type);
        if (!provider) {
            const available = this.getTypes();
            throw new Error(
                `Unknown blob store type: '${parsed.type}'. ` +
                    `Available types: ${available.length > 0 ? available.join(', ') : 'none'}`
            );
        }

        // Validate against provider schema (returns properly typed config)
        return provider.configSchema.parse(config);
    }

    /**
     * Clear all registered providers.
     * Mainly useful for testing.
     */
    clear(): void {
        this.providers.clear();
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
