import type { DatabaseProvider } from '../provider.js';
import type { PostgresDatabaseConfig } from '../schemas.js';
import { PostgresDatabaseSchema } from '../schemas.js';
import { StorageError } from '../../errors.js';

/**
 * Provider for PostgreSQL database storage.
 *
 * This provider stores data in a PostgreSQL database server using the pg package.
 * It's ideal for production deployments requiring scalability and multi-machine access.
 *
 * Features:
 * - Connection pooling for efficient resource usage
 * - JSONB storage for flexible data types
 * - Transaction support
 * - Suitable for distributed deployments
 *
 * Note: pg is an optional dependency. Install it with:
 * npm install pg
 */
export const postgresDatabaseProvider: DatabaseProvider<'postgres', PostgresDatabaseConfig> = {
    type: 'postgres',
    configSchema: PostgresDatabaseSchema,
    create: async (config, logger) => {
        try {
            const module = await import('../postgres-store.js');
            logger.info('Connecting to PostgreSQL database');
            return new module.PostgresStore(config, logger);
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ERR_MODULE_NOT_FOUND') {
                throw StorageError.dependencyNotInstalled('PostgreSQL', 'pg', 'npm install pg');
            }
            throw error;
        }
    },
    metadata: {
        displayName: 'PostgreSQL',
        description: 'Production PostgreSQL database with connection pooling',
        requiresNetwork: true,
        supportsListOperations: true,
    },
};
