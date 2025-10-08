/**
 * Internal resources provider and registry
 */

export { InternalResourcesProvider } from './internal-provider.js';

export {
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './internal-registry.js';
export type {
    InternalResourceConfig,
    InternalResourceHandler,
    InternalResourceServices,
    BlobResourceConfig,
} from './internal-registry.js';

// TODO: (355) Delete this file
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413194816
// Legacy BlobStore has been fully migrated to BlobService
// All blob storage functionality is now provided by the infrastructure-level BlobService
