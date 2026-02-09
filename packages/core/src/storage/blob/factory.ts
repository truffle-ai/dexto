import type { BlobStore } from './types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { StorageError } from '../errors.js';
import {
    BLOB_STORE_TYPES,
    BlobStoreConfigSchema,
    InMemoryBlobStoreSchema,
    LocalBlobStoreSchema,
} from './schemas.js';
import { InMemoryBlobStore } from './memory-blob-store.js';
import { LocalBlobStore } from './local-blob-store.js';

/**
 * Create a blob store based on configuration.
 *
 * NOTE: This currently supports only core built-in providers. Custom providers are
 * resolved by the product-layer resolver (`@dexto/agent-config`) during the DI refactor.
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match an available provider.
 *
 * @param config - Blob store configuration with a 'type' discriminator
 * @param logger - Logger instance for the blob store
 * @returns A BlobStore implementation
 * @throws Error if validation fails or the provider type is unknown
 */
export function createBlobStore(
    // TODO: temporary glue code to be removed/verified
    config: unknown,
    logger: IDextoLogger
): BlobStore {
    const parsedConfig = BlobStoreConfigSchema.safeParse(config);
    if (!parsedConfig.success) {
        throw StorageError.blobInvalidConfig(parsedConfig.error.message);
    }

    const type = parsedConfig.data.type;

    switch (type) {
        case 'local': {
            const localConfig = LocalBlobStoreSchema.parse(config);
            logger.info('Using Local Filesystem blob store');
            return new LocalBlobStore(localConfig, logger);
        }
        case 'in-memory': {
            const memoryConfig = InMemoryBlobStoreSchema.parse(config);
            logger.info('Using In-Memory blob store');
            return new InMemoryBlobStore(memoryConfig, logger);
        }
        default:
            throw StorageError.unknownBlobProvider(type, [...BLOB_STORE_TYPES]);
    }
}
