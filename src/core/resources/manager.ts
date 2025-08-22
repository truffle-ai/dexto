import type { MCPManager } from '../mcp/manager.js';
import type { ResourceSet } from './types.js';
import { MCPResourceProvider } from './mcp-provider.js';
import { InternalResourcesProvider } from './internal-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';
import { logger } from '../logger/index.js';

/**
 * Options for ResourceManager initialization
 */
export interface ResourceManagerOptions {
    internalResourcesConfig?: ValidatedInternalResourcesConfig;
}

/**
 * Simplified Resource Manager
 *
 * Manages resources from two sources:
 * - MCP servers (external)
 * - Internal resources (extensible via registry)
 *
 * Architecture:
 * Application → ResourceManager → [MCPResourceProvider, InternalResourcesProvider]
 */
export class ResourceManager {
    private mcpManager: MCPManager;
    private mcpResourceProvider: MCPResourceProvider;
    private internalResourcesProvider?: InternalResourcesProvider;

    // Resource source prefixing
    private static readonly MCP_RESOURCE_PREFIX = 'mcp--';
    private static readonly INTERNAL_RESOURCE_PREFIX = 'internal--';

    // Resource caching for performance
    private resourcesCache: ResourceSet = {};
    private cacheValid: boolean = false;

    constructor(mcpManager: MCPManager, options?: ResourceManagerOptions) {
        this.mcpManager = mcpManager;

        // Initialize MCP resource provider
        this.mcpResourceProvider = new MCPResourceProvider(mcpManager);

        // Initialize internal resources if configured
        if (options?.internalResourcesConfig?.enabled) {
            this.internalResourcesProvider = new InternalResourcesProvider(
                options.internalResourcesConfig
            );
        }

        logger.debug('ResourceManager initialized');
    }

    /**
     * Initialize the ResourceManager and its components
     */
    async initialize(): Promise<void> {
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.initialize();
        }
        await this.buildResourceCache();
        logger.debug('ResourceManager initialization complete');
    }

    /**
     * Invalidate the resources cache
     */
    private invalidateCache(): void {
        this.cacheValid = false;
        this.resourcesCache = {};
        this.mcpResourceProvider.invalidateCache();
        if (this.internalResourcesProvider) {
            this.internalResourcesProvider.invalidateCache();
        }
        logger.debug('ResourceManager cache invalidated');
    }

    /**
     * Build unified resource cache with universal prefixing
     */
    private async buildResourceCache(): Promise<void> {
        const allResources: ResourceSet = {};

        // Get resources from both sources
        let mcpResources: any[] = [];
        let internalResources: any[] = [];

        try {
            mcpResources = await this.mcpResourceProvider.listResources();
        } catch (error) {
            logger.error(
                `Failed to get MCP resources: ${error instanceof Error ? error.message : String(error)}`
            );
            mcpResources = [];
        }

        try {
            internalResources = this.internalResourcesProvider?.listResources
                ? await this.internalResourcesProvider.listResources()
                : [];
        } catch (error) {
            logger.error(
                `Failed to get internal resources: ${error instanceof Error ? error.message : String(error)}`
            );
            internalResources = [];
        }

        // Add internal resources with prefix
        for (const resource of internalResources) {
            const qualifiedUri = `${ResourceManager.INTERNAL_RESOURCE_PREFIX}${resource.uri}`;
            allResources[qualifiedUri] = {
                ...resource,
                uri: qualifiedUri,
                description: `${resource.description || 'No description provided'} (internal resource)`,
            };
        }

        // Add MCP resources with prefix
        for (const resource of mcpResources) {
            const qualifiedUri = `${ResourceManager.MCP_RESOURCE_PREFIX}${resource.uri.replace(/^mcp--/, '')}`;
            allResources[qualifiedUri] = {
                ...resource,
                uri: qualifiedUri,
                description: `${resource.description || 'No description provided'} (via MCP servers)`,
            };
        }

        this.resourcesCache = allResources;
        this.cacheValid = true;

        const totalResources = Object.keys(allResources).length;
        const mcpCount = mcpResources.length;
        const internalCount = internalResources.length;

        logger.debug(
            `🗃️ Unified resource discovery: ${totalResources} total resources (${mcpCount} MCP → ${ResourceManager.MCP_RESOURCE_PREFIX}*, ${internalCount} internal → ${ResourceManager.INTERNAL_RESOURCE_PREFIX}*)`
        );
    }

    /**
     * List all available resources
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
     * Read resource content by routing based on prefix
     */
    async read(uri: string): Promise<ReadResourceResult> {
        logger.debug(`📖 Reading resource: ${uri}`);

        try {
            let result: ReadResourceResult;

            // Route to MCP resources
            if (uri.startsWith(ResourceManager.MCP_RESOURCE_PREFIX)) {
                logger.debug(`🗃️ Detected MCP resource: '${uri}'`);
                const actualUri = uri.substring(ResourceManager.MCP_RESOURCE_PREFIX.length);
                if (actualUri.length === 0) {
                    throw new Error(`Resource URI cannot be empty after prefix: ${uri}`);
                }
                logger.debug(`🎯 MCP routing: '${uri}' -> '${actualUri}'`);
                result = await this.mcpResourceProvider.readResource(`mcp--${actualUri}`);
            }
            // Route to internal resources
            else if (uri.startsWith(ResourceManager.INTERNAL_RESOURCE_PREFIX)) {
                logger.debug(`🗃️ Detected internal resource: '${uri}'`);
                const actualUri = uri.substring(ResourceManager.INTERNAL_RESOURCE_PREFIX.length);
                if (actualUri.length === 0) {
                    throw new Error(`Resource URI cannot be empty after prefix: ${uri}`);
                }
                if (!this.internalResourcesProvider) {
                    throw new Error(`Internal resources not initialized for: ${uri}`);
                }
                logger.debug(`🎯 Internal routing: '${uri}' -> '${actualUri}'`);
                result = await this.internalResourcesProvider.readResource(actualUri);
            }
            // Resource doesn't have proper prefix
            else {
                logger.debug(`🗃️ Detected resource without proper prefix: '${uri}'`);
                logger.error(
                    `❌ Resource missing source prefix: '${uri}' (expected '${ResourceManager.MCP_RESOURCE_PREFIX}*' or '${ResourceManager.INTERNAL_RESOURCE_PREFIX}*')`
                );
                throw new Error(`Resource not found: ${uri}`);
            }

            logger.debug(`✅ Successfully read resource: ${uri}`);
            return result;
        } catch (error) {
            logger.error(
                `❌ Failed to read resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Refresh all resource caches
     */
    async refresh(): Promise<void> {
        this.invalidateCache();
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.refresh();
        }
        await this.buildResourceCache();
        logger.info('ResourceManager refreshed');
    }

    /**
     * Get MCP resource provider for direct access
     */
    getMcpResourceProvider(): MCPResourceProvider {
        return this.mcpResourceProvider;
    }

    /**
     * Get internal resources provider for direct access
     */
    getInternalResourcesProvider(): InternalResourcesProvider | undefined {
        return this.internalResourcesProvider;
    }
}
