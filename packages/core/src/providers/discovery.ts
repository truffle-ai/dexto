import { inMemoryBlobStoreProvider, localBlobStoreProvider } from '../storage/blob/index.js';
import {
    inMemoryDatabaseProvider,
    postgresDatabaseProvider,
    sqliteDatabaseProvider,
} from '../storage/database/index.js';
import { noopProvider, reactiveOverflowProvider } from '../context/compaction/index.js';
import { customToolRegistry } from '../tools/custom-tool-registry.js';
import { INTERNAL_TOOL_NAMES } from '../tools/internal-tools/constants.js';
import { INTERNAL_TOOL_REGISTRY } from '../tools/internal-tools/registry.js';

/**
 * Information about a registered provider.
 */
export interface DiscoveredProvider {
    /** Provider type identifier (e.g., 'local', 's3', 'reactive-overflow') */
    type: string;

    /** Provider category */
    category: 'blob' | 'database' | 'compaction' | 'customTools';

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
 * Information about an internal tool for discovery.
 */
export interface InternalToolDiscovery {
    /** Tool name identifier (e.g., 'search_history', 'ask_user') */
    name: string;

    /** Human-readable description of what the tool does */
    description: string;
}

/**
 * Discovery result with providers grouped by category.
 */
export interface ProviderDiscovery {
    /** Blob storage providers */
    blob: DiscoveredProvider[];

    /** Database providers */
    database: DiscoveredProvider[];

    /** Compaction strategy providers */
    compaction: DiscoveredProvider[];

    /** Custom tool providers */
    customTools: DiscoveredProvider[];

    /** Internal tools available for configuration */
    internalTools: InternalToolDiscovery[];
}

/**
 * Provider category type.
 */
export type ProviderCategory = 'blob' | 'database' | 'compaction' | 'customTools';

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
 * console.log('Available compaction providers:', providers.compaction);
 * console.log('Available custom tool providers:', providers.customTools);
 * ```
 */
export function listAllProviders(): ProviderDiscovery {
    // Get blob store providers (built-ins only; custom providers move to images during DI refactor)
    const blobProviders = [localBlobStoreProvider, inMemoryBlobStoreProvider].map((provider) => {
        const info: DiscoveredProvider = {
            type: provider.type,
            category: 'blob',
        };
        if (provider.metadata) {
            info.metadata = provider.metadata;
        }
        return info;
    });

    // Get compaction providers (built-ins only; custom providers move to images during DI refactor)
    const compactionProviders = [reactiveOverflowProvider, noopProvider].map((provider) => {
        const info: DiscoveredProvider = {
            type: provider.type,
            category: 'compaction',
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

    // Get database providers (built-ins only; custom providers move to images during DI refactor)
    const databaseProviders = [
        inMemoryDatabaseProvider,
        sqliteDatabaseProvider,
        postgresDatabaseProvider,
    ].map((provider) => {
        const info: DiscoveredProvider = {
            type: provider.type,
            category: 'database',
        };
        if (provider.metadata) {
            info.metadata = provider.metadata;
        }
        return info;
    });

    // Get internal tools
    const internalTools: InternalToolDiscovery[] = INTERNAL_TOOL_NAMES.map((name) => ({
        name,
        description: INTERNAL_TOOL_REGISTRY[name].description,
    }));

    return {
        blob: blobProviders,
        database: databaseProviders,
        compaction: compactionProviders,
        customTools: customToolProviders,
        internalTools,
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
 * if (hasProvider('compaction', 'reactive-overflow')) {
 *   console.log('Reactive overflow compaction is available');
 * }
 * ```
 */
export function hasProvider(category: ProviderCategory, type: string): boolean {
    switch (category) {
        case 'blob':
            return type === localBlobStoreProvider.type || type === inMemoryBlobStoreProvider.type;
        case 'database':
            return (
                type === inMemoryDatabaseProvider.type ||
                type === sqliteDatabaseProvider.type ||
                type === postgresDatabaseProvider.type
            );
        case 'compaction':
            return type === reactiveOverflowProvider.type || type === noopProvider.type;
        case 'customTools':
            return customToolRegistry.has(type);
        default:
            return false;
    }
}
