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

export type { InternalResourcesConfig, ValidatedInternalResourcesConfig } from './schemas.js';

export { ResourceManager } from './manager.js';

export { InternalResourcesProvider } from './internal-provider.js';

export {
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './internal-registry.js';

export type {
    InternalResourceConfig,
    InternalResourceHandler,
    InternalResourceServices,
} from './internal-registry.js';

export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';
export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';

export { ResourceError } from './errors.js';
export { ResourceErrorCode } from './error-codes.js';
