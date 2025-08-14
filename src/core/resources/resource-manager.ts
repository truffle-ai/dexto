import type { MCPManager } from '../mcp/manager.js';
import type { ResourceProvider, ResourceSet } from './types.js';
import { MCPResourceProvider } from './providers/mcp-resource-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';

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

    // Resource caching for performance
    private resourcesCache: ResourceSet = {};
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager) {
        this.mcpManager = mcpManager;

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
     * List all available resources with their info
     */
    async list(): Promise<ResourceSet> {
        if (!this.cacheValid) {
            await this.buildResourceCache();
        }
        return this.resourcesCache;
    }

    /**
     * Check if a resource exists
     */
    async has(uri: string): Promise<boolean> {
        const resources = await this.list();
        return uri in resources;
    }

    /**
     * Read the content of a specific resource
     */
    async read(uri: string): Promise<ReadResourceResult> {
        const resources = await this.list();
        const metadata = resources[uri];
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
