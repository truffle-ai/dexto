import type { Database } from './types.js';
import type { DatabaseConfig, PostgresDatabaseConfig, SqliteDatabaseConfig } from '../schemas.js';
import { MemoryDatabaseStore } from './memory-database-store.js';
import { logger } from '../../logger/index.js';

// Types for database store constructors
interface SQLiteStoreConstructor {
    new (config: SqliteDatabaseConfig): Database;
}

interface PostgresStoreConstructor {
    new (config: PostgresDatabaseConfig): Database;
}

// Lazy imports for optional dependencies
let SQLiteStore: SQLiteStoreConstructor | null = null;
let PostgresStore: PostgresStoreConstructor | null = null;

/**
 * Create a database store based on configuration.
 * Handles lazy loading of optional dependencies with automatic fallback.
 */
export async function createDatabase(config: DatabaseConfig): Promise<Database> {
    switch (config.type) {
        case 'postgres':
            return createPostgresStore(config);

        case 'sqlite':
            return createSQLiteStore(config);

        case 'in-memory':
        default:
            logger.info('Using in-memory database store');
            return new MemoryDatabaseStore();
    }
}

async function createPostgresStore(config: PostgresDatabaseConfig): Promise<Database> {
    try {
        if (!PostgresStore) {
            const module = await import('./postgres-store.js');
            PostgresStore = module.PostgresStore;
        }
        logger.info('Connecting to PostgreSQL database');
        return new PostgresStore(config);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
            `PostgreSQL not available, falling back to in-memory database: ${errorMessage}`
        );
        return new MemoryDatabaseStore();
    }
}

async function createSQLiteStore(config: SqliteDatabaseConfig): Promise<Database> {
    try {
        if (!SQLiteStore) {
            const module = await import('./sqlite-store.js');
            SQLiteStore = module.SQLiteStore;
        }
        logger.info(`Using SQLite database at ${config.path}`);
        return new SQLiteStore(config);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`SQLite store failed to load: ${err.message}`, err);
        logger.warn('Falling back to in-memory database store');
        return new MemoryDatabaseStore();
    }
}
