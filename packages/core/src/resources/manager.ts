import type { MCPManager } from '../mcp/manager.js';
import type { ResourceSet, ResourceMetadata } from './types.js';
import { AgentResourcesProvider } from './agent-resources-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedResourcesConfig } from './schemas.js';
import type { InternalResourceServices } from './handlers/types.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { eventBus } from '../events/index.js';
import type { BlobStore } from '../storage/blob/types.js';

export interface ResourceManagerOptions {
    resourcesConfig: ValidatedResourcesConfig;
    blobStore: BlobStore;
}

export class ResourceManager {
    private readonly mcpManager: MCPManager;
    private agentResourcesProvider: AgentResourcesProvider;
    private readonly blobStore: BlobStore;
    private logger: Logger;

    constructor(mcpManager: MCPManager, options: ResourceManagerOptions, logger: Logger) {
        this.mcpManager = mcpManager;
        this.blobStore = options.blobStore;
        this.logger = logger.createChild(DextoLogComponent.RESOURCE);

        const services: InternalResourceServices = {
            blobStore: this.blobStore,
        };

        this.agentResourcesProvider = new AgentResourcesProvider(
            options.resourcesConfig,
            services,
            this.logger
        );

        // Listen for MCP resource notifications for real-time updates
        this.setupNotificationListeners();

        this.logger.debug('ResourceManager initialized');
    }

    async initialize(): Promise<void> {
        await this.agentResourcesProvider.initialize();
        this.logger.debug('ResourceManager initialization complete');
    }

    getBlobStore(): BlobStore {
        return this.blobStore;
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
                this.logger.debug(
                    `🗃️ Resource discovery (MCP): ${mcpResources.length} resources across ${
                        new Set(mcpResources.map((r) => r.serverName)).size
                    } server(s)`
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to enumerate MCP resources: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        try {
            const internalResources = await this.agentResourcesProvider.listResources();
            for (const resource of internalResources) {
                resources[resource.uri] = resource;
            }
            if (internalResources.length > 0) {
                this.logger.debug(
                    `🗃️ Resource discovery (internal): ${internalResources.length} resources`
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to enumerate internal resources: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        return resources;
    }

    async has(uri: string): Promise<boolean> {
        if (uri.startsWith('mcp:')) {
            return this.mcpManager.hasResource(uri);
        }
        // Always short-circuit blob: URIs to use blobStore directly
        if (uri.startsWith('blob:')) {
            try {
                return await this.blobStore.exists(uri);
            } catch (error) {
                this.logger.warn(
                    `BlobService exists check failed for ${uri}: ${error instanceof Error ? error.message : String(error)}`
                );
                return false;
            }
        }
        return await this.agentResourcesProvider.hasResource(uri);
    }

    async read(uri: string): Promise<ReadResourceResult> {
        this.logger.debug(`📖 Reading resource: ${uri}`);
        try {
            if (uri.startsWith('mcp:')) {
                const result = await this.mcpManager.readResource(uri);
                this.logger.debug(`✅ Successfully read MCP resource: ${uri}`);
                return result;
            }

            // Always short-circuit blob: URIs to use blobStore directly
            if (uri.startsWith('blob:')) {
                const blob = await this.blobStore.retrieve(uri, 'base64');
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

            const result = await this.agentResourcesProvider.readResource(uri);
            this.logger.debug(`✅ Successfully read internal resource: ${uri}`);
            return result;
        } catch (error) {
            this.logger.error(
                `❌ Failed to read resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    async refresh(): Promise<void> {
        await this.agentResourcesProvider.refresh();
        this.logger.info('ResourceManager refreshed');
    }

    getAgentResourcesProvider(): AgentResourcesProvider {
        return this.agentResourcesProvider;
    }

    /**
     * Set up listeners for MCP resource notifications to enable real-time updates
     */
    private setupNotificationListeners(): void {
        // Listen for MCP resource updates
        eventBus.on('mcp:resource-updated', async (payload) => {
            this.logger.debug(
                `🔄 Resource updated notification: ${payload.resourceUri} from server '${payload.serverName}'`
            );

            // Emit a more specific event for components that need to refresh resource lists
            eventBus.emit('resource:cache-invalidated', {
                resourceUri: payload.resourceUri,
                serverName: payload.serverName,
                action: 'updated',
            });
        });

        // Listen for MCP server connection changes that affect resources
        eventBus.on('mcp:server-connected', async (payload) => {
            if (payload.success) {
                this.logger.debug(
                    `🔄 Server connected, resources may have changed: ${payload.name}`
                );
                eventBus.emit('resource:cache-invalidated', {
                    serverName: payload.name,
                    action: 'server_connected',
                });
            }
        });

        eventBus.on('mcp:server-removed', async (payload) => {
            this.logger.debug(`🔄 Server removed, resources invalidated: ${payload.serverName}`);
            eventBus.emit('resource:cache-invalidated', {
                serverName: payload.serverName,
                action: 'server_removed',
            });
        });
    }
}
