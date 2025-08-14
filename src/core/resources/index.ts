/**
 * Resource management module exports
 */

export type {
    ResourceSource,
    ResourceMetadata,
    ResourceContent,
    ResourceProvider,
    ResourceSet,
} from './types.js';

export { ResourceManager } from './resource-manager.js';

export { MCPResourceProvider } from './providers/mcp-resource-provider.js';

export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';
export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';
