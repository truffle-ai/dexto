import type { SqliteDatabaseConfig } from '../schemas.js';
import { SqliteDatabaseSchema } from '../schemas.js';
import { StorageError } from '@dexto/core';
import type { DatabaseFactory } from '../factory.js';

/**
 * Factory for SQLite database storage.
 *
 * This factory stores data in a local SQLite database file using bun:sqlite (Bun runtime)
 * or better-sqlite3 (Node runtime fallback).
 * It's ideal for single-machine deployments and development scenarios where
 * persistence is required without the overhead of a database server.
 *
 * Features:
 * - Uses synchronous, fast operations
 * - WAL mode enabled for better concurrency
 * - No external server required
 * - Persistent storage survives restarts
 */
export const sqliteDatabaseFactory: DatabaseFactory<SqliteDatabaseConfig> = {
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
                    'bun add better-sqlite3'
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
