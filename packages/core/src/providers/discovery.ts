import { blobStoreRegistry } from '../storage/blob/index.js';
import { compressionRegistry } from '../context/compression/index.js';
import { customToolRegistry } from '../tools/custom-tool-registry.js';

/**
 * Information about a registered provider.
 */
export interface DiscoveredProvider {
    /** Provider type identifier (e.g., 'local', 's3', 'reactive-overflow') */
    type: string;

    /** Provider category */
    category: 'blob' | 'compression' | 'customTools';

    /** Optional metadata about the provider */
    metadata?:
        | {
              displayName?: string;
              description?: string;
              [key: string]: any;
          }
        | undefined;
}

/**
 * Discovery result with providers grouped by category.
 */
export interface ProviderDiscovery {
    /** Blob storage providers */
    blob: DiscoveredProvider[];

    /** Compression strategy providers */
    compression: DiscoveredProvider[];

    /** Custom tool providers */
    customTools: DiscoveredProvider[];
}

/**
 * Provider category type.
 */
export type ProviderCategory = 'blob' | 'compression' | 'customTools';

/**
 * List all registered providers across all registries.
 *
 * This function is useful for debugging and building UIs that need to display
 * available providers. It queries all provider registries and returns a
 * comprehensive view of what's currently registered.
 *
 * @returns Object with providers grouped by category
 *
 * @example
 * ```typescript
 * const providers = listAllProviders();
 * console.log('Available blob providers:', providers.blob);
 * console.log('Available compression providers:', providers.compression);
 * console.log('Available custom tool providers:', providers.customTools);
 * ```
 */
export function listAllProviders(): ProviderDiscovery {
    // Get blob store providers
    const blobProviders = blobStoreRegistry.getProviders().map((provider) => {
        const info: DiscoveredProvider = {
            type: provider.type,
            category: 'blob',
        };
        if (provider.metadata) {
            info.metadata = provider.metadata;
        }
        return info;
    });

    // Get compression providers
    const compressionProviders = compressionRegistry.getAll().map((provider) => {
        const info: DiscoveredProvider = {
            type: provider.type,
            category: 'compression',
        };
        if (provider.metadata) {
            info.metadata = provider.metadata;
        }
        return info;
    });

    // Get custom tool providers
    const customToolProviders = customToolRegistry.getTypes().map((type) => {
        const provider = customToolRegistry.get(type);
        const info: DiscoveredProvider = {
            type,
            category: 'customTools',
        };
        if (provider?.metadata) {
            info.metadata = provider.metadata;
        }
        return info;
    });

    return {
        blob: blobProviders,
        compression: compressionProviders,
        customTools: customToolProviders,
    };
}

/**
 * Get all providers for a specific category.
 *
 * @param category - The provider category to query
 * @returns Array of provider information for the specified category
 *
 * @example
 * ```typescript
 * const blobProviders = getProvidersByCategory('blob');
 * blobProviders.forEach(p => {
 *   console.log(`${p.type}: ${p.metadata?.displayName}`);
 * });
 * ```
 */
export function getProvidersByCategory(category: ProviderCategory): DiscoveredProvider[] {
    const allProviders = listAllProviders();
    return allProviders[category];
}

/**
 * Check if a specific provider exists in a category.
 *
 * @param category - The provider category to check
 * @param type - The provider type identifier
 * @returns True if the provider is registered, false otherwise
 *
 * @example
 * ```typescript
 * if (hasProvider('blob', 's3')) {
 *   console.log('S3 blob storage is available');
 * }
 *
 * if (hasProvider('compression', 'reactive-overflow')) {
 *   console.log('Reactive overflow compression is available');
 * }
 * ```
 */
export function hasProvider(category: ProviderCategory, type: string): boolean {
    switch (category) {
        case 'blob':
            return blobStoreRegistry.has(type);
        case 'compression':
            return compressionRegistry.has(type);
        case 'customTools':
            return customToolRegistry.has(type);
        default:
            return false;
    }
}
