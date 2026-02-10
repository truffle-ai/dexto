import { DextoLogComponent, StorageManager } from '@dexto/core';
import type { IDextoLogger } from '@dexto/core';
import type { ValidatedStorageConfig } from './schemas.js';
import { createBlobStore } from './blob/index.js';
import { createCache } from './cache/index.js';
import { createDatabase } from './database/index.js';

/**
 * Convenience helper to build and connect a `StorageManager` from validated config.
 *
 * NOTE: This exists for transitional host wiring during the DI refactor.
 * Longer-term, product layers resolve storage via images + `@dexto/agent-config`.
 */
export async function createStorageManager(
    config: ValidatedStorageConfig,
    logger: IDextoLogger
): Promise<StorageManager> {
    const storageLogger = logger.createChild(DextoLogComponent.STORAGE);

    const cache = await createCache(config.cache, storageLogger);
    const database = await createDatabase(config.database, storageLogger);
    const blobStore = createBlobStore(config.blob, storageLogger);

    const manager = new StorageManager({ cache, database, blobStore }, logger);
    await manager.initialize();
    await manager.connect();
    return manager;
}
