import type { DatabaseProvider } from '../provider.js';
import type { SqliteDatabaseConfig } from '../schemas.js';
import { SqliteDatabaseSchema } from '../schemas.js';
import { StorageError } from '@dexto/core';

/**
 * Provider for SQLite database storage.
 *
 * This provider stores data in a local SQLite database file using better-sqlite3.
 * It's ideal for single-machine deployments and development scenarios where
 * persistence is required without the overhead of a database server.
 *
 * Features:
 * - Uses better-sqlite3 for synchronous, fast operations
 * - WAL mode enabled for better concurrency
 * - No external server required
 * - Persistent storage survives restarts
 *
 * Note: better-sqlite3 is an optional dependency. Install it with:
 * npm install better-sqlite3
 */
export const sqliteDatabaseProvider: DatabaseProvider<'sqlite', SqliteDatabaseConfig> = {
    type: 'sqlite',
    configSchema: SqliteDatabaseSchema,
    create: async (config, logger) => {
        try {
            const module = await import('../sqlite-store.js');
            logger.info(`Creating SQLite database store: ${config.path}`);
            return new module.SQLiteStore(config, logger);
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (
                err.code === 'ERR_MODULE_NOT_FOUND' &&
                typeof err.message === 'string' &&
                err.message.includes('better-sqlite3')
            ) {
                throw StorageError.dependencyNotInstalled(
                    'SQLite',
                    'better-sqlite3',
                    'npm install better-sqlite3'
                );
            }
            throw error;
        }
    },
    metadata: {
        displayName: 'SQLite',
        description: 'Local SQLite database for persistent storage',
        requiresNetwork: false,
        supportsListOperations: true,
    },
};
