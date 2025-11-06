import type { BlobStore } from './types.js';
import type { BlobStoreConfig } from './schemas.js';
import { LocalBlobStore } from './local-blob-store.js';
import { InMemoryBlobStore } from './memory-blob-store.js';
import { logger } from '../../logger/index.js';

/**
 * Create a blob store based on configuration.
 * Blob paths are provided via CLI enrichment layer for local storage.
 * @param config Blob store configuration
 */
export function createBlobStore(config: BlobStoreConfig): BlobStore {
    switch (config.type) {
        case 'in-memory':
            logger.info('Using in-memory blob store');
            return new InMemoryBlobStore(config);

        case 'local':
            logger.info('Using local file-based blob store');
            return new LocalBlobStore(config);

        default:
            throw new Error(`Unknown blob store type: ${(config as any).type}`);
    }
}
