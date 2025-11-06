import type { BlobStore } from './types.js';
import type { BlobStoreConfig } from './schemas.js';
import { LocalBlobStore } from './local-blob-store.js';
import { logger } from '../../logger/index.js';

/**
 * Create a blob store based on configuration.
 * Note: In-memory blob store not yet implemented.
 * Blob paths are provided via CLI enrichment layer.
 * @param config Blob store configuration with explicit paths
 */
export function createBlobStore(config: BlobStoreConfig): BlobStore {
    switch (config.type) {
        case 'local':
            logger.info('Using local file-based blob store');
            return new LocalBlobStore(config);

        case 'in-memory':
            throw new Error(
                'In-memory blob store not yet implemented. Use local blob storage with explicit storePath.'
            );

        default:
            throw new Error(`Unknown blob store type: ${(config as any).type}`);
    }
}
