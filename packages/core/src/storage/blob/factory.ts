import type { BlobStore } from './types.js';
import type { BlobStoreConfig } from './schemas.js';
import { LocalBlobStore } from './local-blob-store.js';
import { InMemoryBlobStore } from './memory-blob-store.js';
import type { IDextoLogger } from '../../logger/v2/types.js';

/**
 * Create a blob store based on configuration.
 * Blob paths are provided via CLI enrichment layer for local storage.
 * @param config Blob store configuration
 * @param logger Logger instance for logging
 */
export function createBlobStore(config: BlobStoreConfig, logger: IDextoLogger): BlobStore {
    switch (config.type) {
        case 'in-memory':
            logger.info('Using in-memory blob store');
            return new InMemoryBlobStore(config, logger);

        case 'local':
            logger.info('Using local file-based blob store');
            return new LocalBlobStore(config, logger);

        default:
            throw new Error(`Unknown blob store type: ${(config as any).type}`);
    }
}
