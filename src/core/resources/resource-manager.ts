import type { MCPManager } from '../mcp/manager.js';
import type {
    ResourceProvider,
    ResourceMetadata,
    ResourceContent,
    ResourceSet,
    ResourceFilters,
    ResourceQueryOptions,
    ResourceQueryResult,
} from './types.js';
import { MCPResourceProvider } from './providers/mcp-resource-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';

/**
 * Options for ResourceManager configuration
 */
export interface ResourceManagerOptions {
    /** Enable automatic cache refresh when MCP servers change */
    autoRefresh?: boolean;
    /** Maximum number of resources to cache per provider */
    maxCacheSize?: number;
}

/**
 * Unified Resource Manager - Single interface for all resource operations
 *
 * This class acts as the single point of contact for managing resources from multiple sources.
 * It aggregates resources from MCP servers and future plugin sources, providing a unified interface
 * for resource discovery, metadata access, and content retrieval.
 *
 * Responsibilities:
 * - Aggregate resources from MCP servers and other sources with conflict resolution
 * - Provide unified resource interface for discovery and access
 * - Cache resource metadata for performance
 * - Handle cross-source resource conflicts with source prefixing
 * - Support filtering and querying of resources
 *
 * Architecture:
 * Application → ResourceManager → [MCPResourceProvider, PluginResourceProvider, CustomResourceProvider]
 */
export class ResourceManager {
    private mcpManager: MCPManager;
    private mcpResourceProvider: MCPResourceProvider;
    private customProviders: Map<string, ResourceProvider> = new Map();
    private options: ResourceManagerOptions;

    // Resource caching for performance
    private resourcesCache: ResourceSet = {};
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager, options: ResourceManagerOptions = {}) {
        this.mcpManager = mcpManager;
        this.options = {
            autoRefresh: true,
            maxCacheSize: 10000,
            ...options,
        };

        // Initialize MCP resource provider
        this.mcpResourceProvider = new MCPResourceProvider(mcpManager);

        logger.debug('ResourceManager initialized');
    }

    /**
     * Initialize the ResourceManager and its components
     */
    async initialize(): Promise<void> {
        // Initial cache build
        await this.buildResourceCache();
        logger.debug('ResourceManager initialization complete');
    }

    /**
     * Register a custom resource provider
     */
    registerProvider(name: string, provider: ResourceProvider): void {
        if (this.customProviders.has(name)) {
            logger.warn(`Resource provider '${name}' already registered. Overwriting.`);
        }

        this.customProviders.set(name, provider);
        this.invalidateCache();
        logger.info(`Registered custom resource provider: ${name}`);
    }

    /**
     * Unregister a custom resource provider
     */
    unregisterProvider(name: string): void {
        if (this.customProviders.delete(name)) {
            this.invalidateCache();
            logger.info(`Unregistered custom resource provider: ${name}`);
        }
    }

    /**
     * Invalidate the resources cache
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.resourcesCache = {};
        this.mcpResourceProvider.invalidateCache();
        logger.debug('ResourceManager cache invalidated');
    }

    /**
     * Build the unified resource cache from all providers
     */
    private async buildResourceCache(): Promise<void> {
        const allResources: ResourceSet = {};

        // Get MCP resources
        try {
            const mcpResources = await this.mcpResourceProvider.listResources();
            mcpResources.forEach((resource) => {
                allResources[resource.uri] = resource;
            });
            logger.debug(`📁 Cached ${mcpResources.length} MCP resources`);
        } catch (error) {
            logger.error(
                `Failed to get MCP resources: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Get resources from custom providers
        for (const [providerName, provider] of this.customProviders.entries()) {
            try {
                const providerResources = await provider.listResources();
                providerResources.forEach((resource) => {
                    // Add provider prefix to avoid conflicts
                    const qualifiedUri = `${provider.getSource()}--${providerName}--${resource.uri}`;
                    allResources[qualifiedUri] = {
                        ...resource,
                        uri: qualifiedUri,
                        description: `${resource.description || 'Resource'} (via ${providerName})`,
                        metadata: {
                            ...resource.metadata,
                            originalUri: resource.uri,
                            providerName,
                        },
                    };
                });
                logger.debug(
                    `📁 Cached ${providerResources.length} resources from provider '${providerName}'`
                );
            } catch (error) {
                logger.error(
                    `Failed to get resources from provider '${providerName}': ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        this.resourcesCache = allResources;
        this.cacheValid = true;

        const totalResources = Object.keys(allResources).length;
        logger.debug(`🗃️  Resource discovery: ${totalResources} total resources`);

        if (totalResources > 0) {
            const sampleUris = Object.keys(allResources).slice(0, 5);
            logger.debug(
                `Sample resources: ${sampleUris.join(', ')}${totalResources > 5 ? '...' : ''}`
            );
        }
    }

    /**
     * Get all available resources from all sources
     */
    async getAllResources(): Promise<ResourceSet> {
        if (!this.cacheValid) {
            await this.buildResourceCache();
        }
        return this.resourcesCache;
    }

    /**
     * Get resource metadata by URI
     */
    async getResourceMetadata(uri: string): Promise<ResourceMetadata | undefined> {
        const resources = await this.getAllResources();
        return resources[uri];
    }

    /**
     * Check if a resource exists
     */
    async hasResource(uri: string): Promise<boolean> {
        const resources = await this.getAllResources();
        return uri in resources;
    }

    /**
     * Read the content of a specific resource
     */
    async readResource(uri: string): Promise<ReadResourceResult> {
        const metadata = await this.getResourceMetadata(uri);
        if (!metadata) {
            throw new Error(`Resource not found: ${uri}`);
        }

        logger.debug(`📖 Reading resource: ${uri}`);

        // Route to appropriate provider based on source
        if (metadata.source === 'mcp') {
            return await this.mcpResourceProvider.readResource(uri);
        }

        // Handle custom providers
        const providerName = metadata.metadata?.providerName as string;
        if (providerName && this.customProviders.has(providerName)) {
            const provider = this.customProviders.get(providerName)!;
            const originalUri = (metadata.metadata?.originalUri as string) || uri;
            return await provider.readResource(originalUri);
        }

        throw new Error(`No provider found for resource: ${uri}`);
    }

    /**
     * Query resources with filters and options
     */
    async queryResources(options: ResourceQueryOptions = {}): Promise<ResourceQueryResult> {
        const allResources = await this.getAllResources();
        const { filters, includeContent = false } = options;

        let resources = Object.values(allResources);

        // Apply filters
        if (filters) {
            resources = this.applyFilters(resources, filters);
        }

        const total = resources.length;

        // Apply limit
        if (filters?.limit && filters.limit > 0) {
            resources = resources.slice(0, filters.limit);
        }

        // Build result
        const result: ResourceContent[] = [];

        for (const metadata of resources) {
            if (includeContent) {
                try {
                    const content = await this.readResource(metadata.uri);
                    result.push({ metadata, content });
                } catch (error) {
                    logger.warn(
                        `Failed to read content for resource ${metadata.uri}: ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                    // Include metadata even if content fails to load
                    result.push({
                        metadata,
                        content: { contents: [], _meta: {} } as ReadResourceResult,
                    });
                }
            } else {
                result.push({
                    metadata,
                    content: { contents: [], _meta: {} } as ReadResourceResult,
                });
            }
        }

        return {
            resources: result,
            total,
            hasMore: filters?.limit ? total > filters.limit : false,
        };
    }

    /**
     * Apply filters to a list of resources
     */
    private applyFilters(
        resources: ResourceMetadata[],
        filters: ResourceFilters
    ): ResourceMetadata[] {
        let filtered = resources;

        // Filter by source
        if (filters.source) {
            const sources = Array.isArray(filters.source) ? filters.source : [filters.source];
            filtered = filtered.filter((resource) => sources.includes(resource.source));
        }

        // Filter by MIME type
        if (filters.mimeType) {
            const mimeTypes = Array.isArray(filters.mimeType)
                ? filters.mimeType
                : [filters.mimeType];
            filtered = filtered.filter(
                (resource) => resource.mimeType && mimeTypes.includes(resource.mimeType)
            );
        }

        // Filter by server name (for MCP resources)
        if (filters.serverName) {
            const serverNames = Array.isArray(filters.serverName)
                ? filters.serverName
                : [filters.serverName];
            filtered = filtered.filter(
                (resource) => resource.serverName && serverNames.includes(resource.serverName)
            );
        }

        // Text search in name or description
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            filtered = filtered.filter(
                (resource) =>
                    (resource.name && resource.name.toLowerCase().includes(searchLower)) ||
                    (resource.description &&
                        resource.description.toLowerCase().includes(searchLower)) ||
                    resource.uri.toLowerCase().includes(searchLower)
            );
        }

        return filtered;
    }

    /**
     * Get resource statistics
     */
    async getResourceStats(): Promise<{
        total: number;
        mcp: number;
        plugin: number;
        custom: number;
        byServer: Record<string, number>;
    }> {
        const resources = await this.getAllResources();
        const resourceList = Object.values(resources);

        const stats = {
            total: resourceList.length,
            mcp: 0,
            plugin: 0,
            custom: 0,
            byServer: {} as Record<string, number>,
        };

        resourceList.forEach((resource) => {
            // Count by source
            if (resource.source === 'mcp') {
                stats.mcp++;
            } else if (resource.source === 'plugin') {
                stats.plugin++;
            } else {
                stats.custom++;
            }

            // Count by server (for MCP resources)
            if (resource.serverName) {
                stats.byServer[resource.serverName] =
                    (stats.byServer[resource.serverName] || 0) + 1;
            }
        });

        return stats;
    }

    /**
     * Refresh all resource caches
     */
    async refresh(): Promise<void> {
        this.invalidateCache();
        await this.buildResourceCache();
        logger.info('ResourceManager refreshed');
    }

    /**
     * Get MCP resource provider for direct access
     */
    getMcpResourceProvider(): MCPResourceProvider {
        return this.mcpResourceProvider;
    }
}
