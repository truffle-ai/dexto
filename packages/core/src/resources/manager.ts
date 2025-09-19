import type { MCPManager } from '../mcp/manager.js';
import type { ResourceSet, ResourceMetadata } from './types.js';
import { InternalResourcesProvider } from './internal-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';
import type { InternalResourceServices } from './internal-registry.js';
import { logger } from '../logger/index.js';
import { ResourceError } from './errors.js';
import { eventBus } from '../events/index.js';

export interface ResourceManagerOptions {
    internalResourcesConfig?: ValidatedInternalResourcesConfig;
    blobService?: import('../blob/index.js').BlobService;
}

export class ResourceManager {
    private readonly mcpManager: MCPManager;
    private internalResourcesProvider?: InternalResourcesProvider;
    private readonly blobService: import('../blob/index.js').BlobService | undefined;

    constructor(mcpManager: MCPManager, options?: ResourceManagerOptions) {
        this.mcpManager = mcpManager;
        this.blobService = options?.blobService;

        const services: InternalResourceServices = {};
        if (this.blobService) {
            services.blobService = this.blobService;
        }

        const config = options?.internalResourcesConfig;
        if (config?.enabled || this.blobService) {
            this.internalResourcesProvider = new InternalResourcesProvider(
                config ?? { enabled: true, resources: [] },
                services
            );
        }

        // Listen for MCP resource notifications for real-time updates
        this.setupNotificationListeners();

        logger.debug('ResourceManager initialized');
    }

    async initialize(): Promise<void> {
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.initialize();
        }
        logger.debug('ResourceManager initialization complete');
    }

    getBlobService(): import('../blob/index.js').BlobService | undefined {
        return this.blobService;
    }

    private deriveName(uri: string): string {
        const segments = uri.split(/[\\/]/).filter(Boolean);
        const lastSegment = segments[segments.length - 1];
        return lastSegment ?? uri;
    }

    async list(): Promise<ResourceSet> {
        const resources: ResourceSet = {};

        try {
            const mcpResources = await this.mcpManager.listAllResources();
            for (const resource of mcpResources) {
                const {
                    key,
                    serverName,
                    summary: { uri, name, description, mimeType },
                } = resource;
                const metadata: ResourceMetadata = {
                    uri: key,
                    name: name ?? this.deriveName(uri),
                    description: description ?? `Resource from MCP server: ${serverName}`,
                    source: 'mcp',
                    serverName,
                    metadata: {
                        originalUri: uri,
                        serverName,
                    },
                };
                if (mimeType) {
                    metadata.mimeType = mimeType;
                }
                resources[key] = metadata;
            }
            if (mcpResources.length > 0) {
                logger.debug(
                    `🗃️ Resource discovery (MCP): ${mcpResources.length} resources across ${
                        new Set(mcpResources.map((r) => r.serverName)).size
                    } server(s)`
                );
            }
        } catch (error) {
            logger.error(
                `Failed to enumerate MCP resources: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        if (this.internalResourcesProvider) {
            try {
                const internalResources = await this.internalResourcesProvider.listResources();
                for (const resource of internalResources) {
                    resources[resource.uri] = resource;
                }
                if (internalResources.length > 0) {
                    logger.debug(
                        `🗃️ Resource discovery (internal): ${internalResources.length} resources`
                    );
                }
            } catch (error) {
                logger.error(
                    `Failed to enumerate internal resources: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        return resources;
    }

    async has(uri: string): Promise<boolean> {
        if (uri.startsWith('mcp:')) {
            return this.mcpManager.hasResource(uri);
        }
        if (!this.internalResourcesProvider) {
            if (uri.startsWith('blob:') && this.blobService) {
                try {
                    return await this.blobService.exists(uri);
                } catch (error) {
                    logger.warn(
                        `BlobService exists check failed for ${uri}: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return false;
                }
            }
            return false;
        }
        return await this.internalResourcesProvider.hasResource(uri);
    }

    async read(uri: string): Promise<ReadResourceResult> {
        logger.debug(`📖 Reading resource: ${uri}`);
        try {
            if (uri.startsWith('mcp:')) {
                const result = await this.mcpManager.readResource(uri);
                logger.debug(`✅ Successfully read MCP resource: ${uri}`);
                return result;
            }

            if (!this.internalResourcesProvider) {
                if (uri.startsWith('blob:') && this.blobService) {
                    const blob = await this.blobService.retrieve(uri, 'base64');
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: blob.metadata.mimeType,
                                blob: blob.data as string,
                            },
                        ],
                        _meta: {
                            size: blob.metadata.size,
                            createdAt: blob.metadata.createdAt,
                            originalName: blob.metadata.originalName,
                            source: blob.metadata.source,
                        },
                    };
                }
                throw ResourceError.providerNotInitialized('Internal', uri);
            }

            const result = await this.internalResourcesProvider.readResource(uri);
            logger.debug(`✅ Successfully read internal resource: ${uri}`);
            return result;
        } catch (error) {
            logger.error(
                `❌ Failed to read resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async refresh(): Promise<void> {
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.refresh();
        }
        logger.info('ResourceManager refreshed');
    }

    getInternalResourcesProvider(): InternalResourcesProvider | undefined {
        return this.internalResourcesProvider;
    }

    /**
     * Set up listeners for MCP resource notifications to enable real-time updates
     */
    private setupNotificationListeners(): void {
        // Listen for MCP resource updates
        eventBus.on('dexto:mcpResourceUpdated', async (payload) => {
            logger.debug(
                `🔄 Resource updated notification: ${payload.resourceUri} from server '${payload.serverName}'`
            );

            // Emit a more specific event for components that need to refresh resource lists
            eventBus.emit('dexto:resourceCacheInvalidated', {
                resourceUri: payload.resourceUri,
                serverName: payload.serverName,
                action: 'updated',
            });
        });

        // Listen for MCP server connection changes that affect resources
        eventBus.on('dexto:mcpServerConnected', async (payload) => {
            if (payload.success) {
                logger.debug(`🔄 Server connected, resources may have changed: ${payload.name}`);
                eventBus.emit('dexto:resourceCacheInvalidated', {
                    serverName: payload.name,
                    action: 'server_connected',
                });
            }
        });

        eventBus.on('dexto:mcpServerRemoved', async (payload) => {
            logger.debug(`🔄 Server removed, resources invalidated: ${payload.serverName}`);
            eventBus.emit('dexto:resourceCacheInvalidated', {
                serverName: payload.serverName,
                action: 'server_removed',
            });
        });
    }

    /**
     * Force refresh of resource data (for components that need to update their local state)
     */
    async getUpdatedResourceList(): Promise<ResourceSet> {
        // This method provides a way for components to get fresh resource data
        // when they receive cache invalidation events
        return await this.list();
    }
}
