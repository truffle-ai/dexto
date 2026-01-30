import type { DatabaseProvider } from '../provider.js';
import type { InMemoryDatabaseConfig } from '../schemas.js';
import { InMemoryDatabaseSchema } from '../schemas.js';
import { MemoryDatabaseStore } from '../memory-database-store.js';

/**
 * Provider for in-memory database storage.
 *
 * This provider stores data in RAM and is ideal for development,
 * testing, and ephemeral use cases where persistence is not required.
 *
 * Features:
 * - Zero external dependencies
 * - Fast in-memory operations
 * - No network required
 * - Data is lost on restart
 */
export const inMemoryDatabaseProvider: DatabaseProvider<'in-memory', InMemoryDatabaseConfig> = {
    type: 'in-memory',
    configSchema: InMemoryDatabaseSchema,
    create: (_config, _logger) => new MemoryDatabaseStore(),
    metadata: {
        displayName: 'In-Memory',
        description: 'Store data in RAM (ephemeral, for testing and development)',
        requiresNetwork: false,
        supportsListOperations: true,
    },
};
