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

export { BlobStore } from './blob-store.js';
export type {
    BlobInput,
    BlobMetadata,
    StoredBlobMetadata,
    BlobReference,
    BlobData,
    BlobStoreConfig,
} from './blob-store.js';
