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

// Legacy BlobStore has been fully migrated to BlobService
// All blob storage functionality is now provided by the infrastructure-level BlobService
