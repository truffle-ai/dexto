import type { BlobStoreProvider } from '../provider.js';
import type { InMemoryBlobStoreConfig } from '../schemas.js';
import { InMemoryBlobStoreSchema } from '../schemas.js';
import { InMemoryBlobStore } from '../memory-blob-store.js';

/**
 * Provider for in-memory blob storage.
 *
 * This provider stores blobs in RAM, making it ideal for testing and
 * development. All data is lost when the process exits.
 *
 * Features:
 * - Zero dependencies
 * - Extremely fast (no I/O)
 * - Configurable size limits
 * - No network required
 * - Perfect for unit tests
 */
export const inMemoryBlobStoreProvider: BlobStoreProvider<'in-memory', InMemoryBlobStoreConfig> = {
    type: 'in-memory',
    configSchema: InMemoryBlobStoreSchema,
    create: (config, logger) => new InMemoryBlobStore(config, logger),
    metadata: {
        displayName: 'In-Memory',
        description: 'Store blobs in RAM (ephemeral, for testing and development)',
        requiresNetwork: false,
    },
};
