import type { MCPManager } from '../../mcp/manager.js';
import type { ResourceProvider, ResourceMetadata, ResourceSource } from '../types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logger/index.js';

/**
 * Resource provider that aggregates resources from MCP servers
 */
export class MCPResourceProvider implements ResourceProvider {
    private mcpManager: MCPManager;
    private resourceCache: Map<string, ResourceMetadata> = new Map();
    private cacheValid: boolean = false;

    // Resource prefixing - resources get prefixed by MCP server name
    private static readonly MCP_RESOURCE_PREFIX = 'mcp--';

    constructor(mcpManager: MCPManager) {
        this.mcpManager = mcpManager;
        logger.debug('MCPResourceProvider initialized');
    }

    /**
     * Invalidate the resource cache when MCP servers change
     */
    invalidateCache(): void {
        this.cacheValid = false;
        this.resourceCache.clear();
        logger.debug('MCPResourceProvider cache invalidated');
    }

    getSource(): ResourceSource {
        return 'mcp';
    }

    /**
     * List all available resources from all connected MCP servers
     */
    async listResources(): Promise<ResourceMetadata[]> {
        if (this.cacheValid && this.resourceCache.size > 0) {
            return Array.from(this.resourceCache.values());
        }

        await this.buildResourceCache();
        return Array.from(this.resourceCache.values());
    }

    /**
     * Build the resource cache by querying all connected MCP servers
     */
    private async buildResourceCache(): Promise<void> {
        const newCache = new Map<string, ResourceMetadata>();
        const clients = this.mcpManager.getClients();

        logger.debug(`🗃️  Building MCP resource cache from ${clients.size} servers`);

        for (const [serverName, client] of clients.entries()) {
            try {
                const resourceUris = await client.listResources();
                logger.debug(`📁 Server '${serverName}' has ${resourceUris.length} resources`);

                for (const uri of resourceUris) {
                    // Create qualified resource URI with server prefix
                    const qualifiedUri = `${MCPResourceProvider.MCP_RESOURCE_PREFIX}${serverName}--${uri}`;

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

                    newCache.set(qualifiedUri, metadata);
                }
            } catch (error) {
                logger.warn(
                    `Failed to list resources from MCP server '${serverName}': ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                // Continue with other servers
            }
        }

        this.resourceCache = newCache;
        this.cacheValid = true;

        logger.debug(`✅ MCP resource cache built: ${this.resourceCache.size} total resources`);
    }

    /**
     * Extract a human-readable name from a resource URI
     */
    private extractResourceName(uri: string): string {
        // Try to extract filename from common URI patterns
        // Handle both forward slashes and backslashes (for mixed paths)
        const forwardSlashParts = uri.split('/');
        const lastForwardSlashPart = forwardSlashParts[forwardSlashParts.length - 1];

        if (lastForwardSlashPart && lastForwardSlashPart.includes('\\')) {
            const backslashParts = lastForwardSlashPart.split('\\');
            return backslashParts[backslashParts.length - 1] || uri;
        }

        if (lastForwardSlashPart && forwardSlashParts.length > 1) {
            return lastForwardSlashPart || uri;
        }

        // If no forward slashes, try backslashes only
        if (uri.includes('\\')) {
            const parts = uri.split('\\');
            return parts[parts.length - 1] || uri;
        }

        return uri;
    }

    /**
     * Parse a qualified resource URI to extract server name and original URI
     */
    private parseQualifiedResourceUri(
        qualifiedUri: string
    ): { serverName: string; originalUri: string } | null {
        if (!qualifiedUri.startsWith(MCPResourceProvider.MCP_RESOURCE_PREFIX)) {
            return null;
        }

        const withoutPrefix = qualifiedUri.substring(
            MCPResourceProvider.MCP_RESOURCE_PREFIX.length
        );
        const delimiterIndex = withoutPrefix.indexOf('--');

        if (delimiterIndex === -1) {
            return null;
        }

        const serverName = withoutPrefix.substring(0, delimiterIndex);
        const originalUri = withoutPrefix.substring(delimiterIndex + 2);

        return { serverName, originalUri };
    }

    /**
     * Check if a resource exists
     */
    async hasResource(uri: string): Promise<boolean> {
        const parsed = this.parseQualifiedResourceUri(uri);
        if (!parsed) {
            return false;
        }

        const client = this.mcpManager.getResourceClient(parsed.originalUri);
        return client !== undefined;
    }

    /**
     * Read the content of a specific resource
     */
    async readResource(uri: string): Promise<ReadResourceResult> {
        const parsed = this.parseQualifiedResourceUri(uri);
        if (!parsed) {
            throw new Error(`Invalid MCP resource URI format: ${uri}`);
        }

        logger.debug(
            `📖 Reading MCP resource: ${parsed.originalUri} from server: ${parsed.serverName}`
        );

        try {
            const result = await this.mcpManager.readResource(parsed.originalUri);
            logger.debug(`✅ Successfully read MCP resource: ${parsed.originalUri}`);
            return result;
        } catch (error) {
            logger.error(
                `❌ Failed to read MCP resource '${parsed.originalUri}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            throw error;
        }
    }

    /**
     * Get resource metadata by URI (from cache)
     */
    async getResourceMetadata(uri: string): Promise<ResourceMetadata | undefined> {
        if (!this.cacheValid) {
            await this.buildResourceCache();
        }
        return this.resourceCache.get(uri);
    }

    /**
     * Refresh the resource cache
     */
    async refresh(): Promise<void> {
        this.invalidateCache();
        await this.buildResourceCache();
        logger.debug('MCPResourceProvider cache refreshed');
    }
}
