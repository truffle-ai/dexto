import type { BlobStore } from './types.js';
import type { BlobStoreConfig, LocalBlobStoreConfig } from '../schemas.js';
import { LocalBlobStore } from './local-blob-store.js';
import { logger } from '../../logger/index.js';

/**
 * Create a blob store based on configuration.
 * Note: In-memory blob store defaults to local file-based storage.
 */
export function createBlobStore(config: BlobStoreConfig): BlobStore {
    switch (config.type) {
        case 'local':
            logger.info('Using local file-based blob store');
            return new LocalBlobStore(config);

        case 'in-memory':
        default: {
            logger.info(
                'In-memory blob store not implemented, defaulting to local file-based storage'
            );
            // Convert in-memory config to local config
            const localConfig: LocalBlobStoreConfig = {
                type: 'local',
                maxBlobSize: config.maxBlobSize,
                maxTotalSize: config.maxTotalSize,
                cleanupAfterDays: 30, // Default for in-memory fallback
            };
            return new LocalBlobStore(localConfig);
        }
    }
}
