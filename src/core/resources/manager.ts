import type { MCPManager } from '../mcp/manager.js';
import type { ResourceSet, ResourceMetadata } from './types.js';
import { InternalResourcesProvider } from './internal-provider.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';
import { logger } from '../logger/index.js';
import { ResourceError } from './errors.js';

/**
 * Options for ResourceManager initialization
 */
export interface ResourceManagerOptions {
    internalResourcesConfig?: ValidatedInternalResourcesConfig;
}

/**
 * Simplified Resource Manager - Thin Coordinator
 *
 * Acts as a thin coordinator that directly accesses MCPManager and InternalResourcesProvider
 * without additional wrapping layers. Uses simple, clear URI prefixes.
 *
 * URI Format:
 * - MCP resources: "mcp:servername:originaluri"
 * - Internal resources: "internal:type:path"
 *
 * Architecture:
 * Application → ResourceManager → [MCPManager, InternalResourcesProvider] (direct access)
 */
export class ResourceManager {
    private mcpManager: MCPManager;
    private internalResourcesProvider?: InternalResourcesProvider;

    constructor(mcpManager: MCPManager, options?: ResourceManagerOptions) {
        this.mcpManager = mcpManager;

        // Initialize internal resources if configured (auto-enabled when resources specified)
        if (options?.internalResourcesConfig?.enabled) {
            this.internalResourcesProvider = new InternalResourcesProvider(
                options.internalResourcesConfig
            );
        }

        logger.debug('ResourceManager initialized as thin coordinator');
    }

    /**
     * Initialize the ResourceManager and its components
     */
    async initialize(): Promise<void> {
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.initialize();
        }
        logger.debug('ResourceManager initialization complete');
    }

    /**
     * Extract a human-readable name from a resource URI
     */
    private extractResourceName(uri: string): string {
        // Handle both forward slashes and backslashes
        const forwardSlashParts = uri.split('/');
        const lastForwardSlashPart = forwardSlashParts[forwardSlashParts.length - 1];

        if (lastForwardSlashPart && lastForwardSlashPart.includes('\\')) {
            const backslashParts = lastForwardSlashPart.split('\\');
            return backslashParts[backslashParts.length - 1] || uri;
        }

        if (lastForwardSlashPart && forwardSlashParts.length > 1) {
            return lastForwardSlashPart || uri;
        }

        if (uri.includes('\\')) {
            const parts = uri.split('\\');
            return parts[parts.length - 1] || uri;
        }

        return uri;
    }

    /**
     * List all available resources with clear URI format
     */
    async list(): Promise<ResourceSet> {
        const resources: ResourceSet = {};

        // Get MCP resources directly from MCPManager
        try {
            const mcpClients = this.mcpManager.getClients();
            for (const [serverName, client] of mcpClients.entries()) {
                try {
                    const resourceUris = await client.listResources();
                    logger.debug(`📁 Server '${serverName}' has ${resourceUris.length} resources`);

                    for (const uri of resourceUris) {
                        // Clean URI format: "mcp:servername:originaluri"
                        const qualifiedUri = `mcp:${serverName}:${uri}`;
                        const metadata: ResourceMetadata = {
                            uri: qualifiedUri,
                            name: this.extractResourceName(uri),
                            description: `Resource from MCP server: ${serverName}`,
                            source: 'mcp',
                            serverName,
                            metadata: {
                                originalUri: uri,
                                serverName,
                            },
                        };
                        resources[qualifiedUri] = metadata;
                    }
                } catch (error) {
                    logger.warn(
                        `Failed to list resources from MCP server '${serverName}': ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            }
        } catch (error) {
            logger.error(
                `Failed to get MCP resources: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Get internal resources if enabled
        if (this.internalResourcesProvider) {
            try {
                const internalResources = await this.internalResourcesProvider.listResources();
                for (const resource of internalResources) {
                    // Clean URI format: "internal:originaluri"
                    const qualifiedUri = `internal:${resource.uri.replace(/^fs:\/\//, '')}`;
                    resources[qualifiedUri] = {
                        ...resource,
                        uri: qualifiedUri,
                        source: 'custom',
                        description: `${resource.description || 'Internal resource'}`,
                    };
                }
            } catch (error) {
                logger.error(
                    `Failed to get internal resources: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const totalResources = Object.keys(resources).length;
        const mcpCount = Object.keys(resources).filter((k) => k.startsWith('mcp:')).length;
        const internalCount = Object.keys(resources).filter((k) =>
            k.startsWith('internal:')
        ).length;

        logger.debug(
            `🗃️ Resource discovery: ${totalResources} total resources (${mcpCount} MCP, ${internalCount} internal)`
        );

        return resources;
    }

    /**
     * Check if a resource exists
     */
    async has(uri: string): Promise<boolean> {
        if (uri.startsWith('mcp:')) {
            const parts = uri.split(':');
            if (parts.length >= 3) {
                const originalUri = parts.slice(2).join(':');
                const client = this.mcpManager.getResourceClient(originalUri);
                return client !== undefined;
            }
        } else if (uri.startsWith('internal:')) {
            const originalUri = uri.substring('internal:'.length);
            if (this.internalResourcesProvider) {
                return await this.internalResourcesProvider.hasResource(`fs://${originalUri}`);
            }
        }
        return false;
    }

    /**
     * Read resource content by parsing clean URI format
     */
    async read(uri: string): Promise<ReadResourceResult> {
        logger.debug(`📖 Reading resource: ${uri}`);

        try {
            // Route to MCP resources: "mcp:servername:originaluri"
            if (uri.startsWith('mcp:')) {
                logger.debug(`🗃️ Detected MCP resource: '${uri}'`);
                const parts = uri.split(':');
                if (parts.length < 3) {
                    throw ResourceError.invalidUriFormat(uri, 'mcp:server:resource');
                }
                const originalUri = parts.slice(2).join(':'); // Rejoin in case original URI had colons
                if (originalUri.length === 0) {
                    throw ResourceError.invalidUriFormat(uri, 'mcp:server:resource');
                }
                logger.debug(`🎯 MCP routing: '${uri}' -> '${originalUri}'`);
                const result = await this.mcpManager.readResource(originalUri);
                logger.debug(`✅ Successfully read MCP resource: ${uri}`);
                return result;
            }
            // Route to internal resources: "internal:path"
            else if (uri.startsWith('internal:')) {
                logger.debug(`🗃️ Detected internal resource: '${uri}'`);
                const originalUri = uri.substring('internal:'.length);
                if (originalUri.length === 0) {
                    throw ResourceError.emptyUri();
                }
                if (!this.internalResourcesProvider) {
                    throw ResourceError.providerNotInitialized('Internal', uri);
                }
                logger.debug(`🎯 Internal routing: '${uri}' -> 'fs://${originalUri}'`);
                const result = await this.internalResourcesProvider.readResource(
                    `fs://${originalUri}`
                );
                logger.debug(`✅ Successfully read internal resource: ${uri}`);
                return result;
            }
            // Invalid URI format
            else {
                logger.error(
                    `❌ Invalid resource URI format: '${uri}' (expected 'mcp:server:uri' or 'internal:path')`
                );
                throw ResourceError.invalidUriFormat(uri, 'mcp:server:resource or internal:path');
            }
        } catch (error) {
            logger.error(
                `❌ Failed to read resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Refresh all resource providers
     */
    async refresh(): Promise<void> {
        if (this.internalResourcesProvider) {
            await this.internalResourcesProvider.refresh();
        }
        // MCP resources are refreshed automatically when clients reconnect
        logger.info('ResourceManager refreshed');
    }

    /**
     * Get internal resources provider for direct access
     */
    getInternalResourcesProvider(): InternalResourcesProvider | undefined {
        return this.internalResourcesProvider;
    }
}
