import type { Database } from './types.js';
import type { IDextoLogger } from '@dexto/core';
import { StorageError } from '@dexto/core';
import { DATABASE_TYPES, DatabaseConfigSchema } from './schemas.js';
import {
    inMemoryDatabaseProvider,
    postgresDatabaseProvider,
    sqliteDatabaseProvider,
} from './providers/index.js';

/**
 * Create a database based on configuration.
 *
 * NOTE: This currently supports only core built-in providers. Custom providers are
 * resolved by the product-layer resolver (`@dexto/agent-config`) during the DI refactor.
 *
 * The configuration type is determined at runtime by the 'type' field,
 * which must match an available provider.
 *
 * Database paths are provided via CLI enrichment layer (for sqlite).
 *
 * @param config - Database configuration with a 'type' discriminator
 * @param logger - Logger instance for the database
 * @returns A Database implementation
 * @throws Error if validation fails or the provider type is unknown
 *
 * @example
 * ```typescript
 * // Using built-in provider
 * const db = await createDatabase({ type: 'sqlite', path: '/tmp/data.db' }, logger);
 * ```
 */
export async function createDatabase(config: unknown, logger: IDextoLogger): Promise<Database> {
    const parsedConfig = DatabaseConfigSchema.safeParse(config);
    if (!parsedConfig.success) {
        throw StorageError.databaseInvalidConfig(parsedConfig.error.message);
    }

    const type = parsedConfig.data.type;

    switch (type) {
        case 'in-memory':
            logger.info('Using In-Memory database');
            return await inMemoryDatabaseProvider.create(parsedConfig.data, logger);
        case 'sqlite':
            logger.info('Using SQLite database');
            return await sqliteDatabaseProvider.create(parsedConfig.data, logger);
        case 'postgres':
            logger.info('Using PostgreSQL database');
            return await postgresDatabaseProvider.create(parsedConfig.data, logger);
        default:
            throw StorageError.unknownDatabaseProvider(type, [...DATABASE_TYPES]);
    }
}
