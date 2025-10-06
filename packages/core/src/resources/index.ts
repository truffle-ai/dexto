/**
 * Resource management module exports
 * Organized into thematic sub-barrels for better tree-shaking and maintainability
 */

// Core resource types and manager
export type {
    ResourceSource,
    ResourceMetadata,
    ResourceProvider,
    ResourceSet,
    InternalResourcesConfig,
    ValidatedInternalResourcesConfig,
} from './core.js';
export { ResourceManager, ResourceError, ResourceErrorCodes } from './core.js';

// Internal resources provider and registry
export type {
    InternalResourceConfig,
    InternalResourceHandler,
    InternalResourceServices,
    BlobResourceConfig,
} from './internal.js';
export {
    InternalResourcesProvider,
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './internal.js';

// Resource reference parsing and expansion
export type { ResourceReference, ResourceExpansionResult } from './reference.js';
export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference.js';

// Schemas and validation
export {
    InternalResourceConfigSchema,
    InternalResourcesSchema,
    isInternalResourcesEnabled,
} from './schemas.js';
