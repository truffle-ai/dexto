/**
 * Resource management module exports
 */

export type {
    ResourceSource,
    ResourceMetadata,
    ResourceContent,
    ResourceProvider,
    ResourceSet,
    ResourceFilters,
    ResourceQueryOptions,
    ResourceQueryResult,
} from './types.js';

export { ResourceManager } from './resource-manager.js';
export type { ResourceManagerOptions } from './resource-manager.js';

export { MCPResourceProvider } from './providers/mcp-resource-provider.js';
