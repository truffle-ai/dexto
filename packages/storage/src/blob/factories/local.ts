import type { LocalBlobStoreConfig } from '../schemas.js';
import { LocalBlobStoreSchema } from '../schemas.js';
import { LocalBlobStore } from '../local-blob-store.js';
import type { BlobStoreFactory } from '../factory.js';

/**
 * Factory for local filesystem blob storage.
 *
 * This factory stores blobs on the local filesystem with content-based
 * deduplication and metadata tracking. It's ideal for development and
 * single-machine deployments.
 *
 * Features:
 * - Zero external dependencies (uses Node.js fs module)
 * - Content-based deduplication (same hash = same blob)
 * - Automatic cleanup of old blobs
 * - No network required
 */
export const localBlobStoreFactory: BlobStoreFactory<LocalBlobStoreConfig> = {
    configSchema: LocalBlobStoreSchema,
    create: (config, logger) => new LocalBlobStore(config, logger),
    metadata: {
        displayName: 'Local Filesystem',
        description: 'Store blobs on the local filesystem with automatic deduplication',
        requiresNetwork: false,
    },
};
