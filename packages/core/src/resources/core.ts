/**
 * Core resource types and main manager
 */

export type { ResourceSource, ResourceMetadata, ResourceProvider, ResourceSet } from './types.js';

export type { InternalResourcesConfig, ValidatedInternalResourcesConfig } from './schemas.js';

export { ResourceManager } from './manager.js';

// TODO: (355) Avoid 'core' files. Don't introduce new inconsistent paradigms for exports. Stick to index, types.ts which we already have everywhere
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413090236
export { ResourceError } from './errors.js';
export { ResourceErrorCodes } from './error-codes.js';
