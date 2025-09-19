/**
 * Core resource types and main manager
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

export { ResourceError } from './errors.js';
export { ResourceErrorCodes } from './error-codes.js';
