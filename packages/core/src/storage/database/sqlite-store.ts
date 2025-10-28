import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type { Database } from './types.js';
import { logger } from '../../logger/index.js';
import type { SqliteDatabaseConfig } from './schemas.js';
import { getDextoPath } from '../../utils/path.js';
import * as path from 'path';
import { StorageError } from '../errors.js';

// Dynamic import for better-sqlite3
let BetterSqlite3Database: any;

/**
 * SQLite database store for local development and production.
 * Implements the Database interface with proper schema and connection handling.
 */
export class SQLiteStore implements Database {
    private db: any | null = null; // Database.Database
    private dbPath: string;
    private config: SqliteDatabaseConfig;
    private agentId: string | undefined;

    constructor(config: SqliteDatabaseConfig, agentId?: string) {
        this.config = config;
        this.agentId = agentId;
        // Path will be resolved in connect() method
        this.dbPath = '';
    }

    private resolveDefaultPath(dbName: string): string {
        // Use reliable path resolution
        const storageDir = getDextoPath('database');
        const finalPath = path.join(storageDir, dbName);

        logger.info(`SQLite storage directory: ${storageDir}`);
        logger.debug(`SQLite database file: ${finalPath}`);

        return finalPath;
    }

    private initializeTables(): void {
        logger.debug('SQLite initializing database schema...');

        try {
            // Create key-value table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `);

            // Create list table for append operations
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS list_store (
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    sequence INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (key, sequence)
                )
            `);

            // Create indexes for better performance
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_kv_store_key ON kv_store(key);
                CREATE INDEX IF NOT EXISTS idx_list_store_key ON list_store(key);
                CREATE INDEX IF NOT EXISTS idx_list_store_sequence ON list_store(key, sequence);
            `);

            logger.debug(
                'SQLite database schema initialized: kv_store, list_store tables with indexes'
            );
        } catch (error) {
            throw StorageError.migrationFailed(
                error instanceof Error ? error.message : String(error),
                {
                    operation: 'table_initialization',
                    backend: 'sqlite',
                }
            );
        }
    }

    async connect(): Promise<void> {
        // Dynamic import of better-sqlite3
        if (!BetterSqlite3Database) {
            try {
                const module = await import('better-sqlite3');
                BetterSqlite3Database = (module as any).default || module;
            } catch (error) {
                throw StorageError.connectionFailed(
                    `Failed to import better-sqlite3: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Initialize database path - use custom path if provided, otherwise auto-detect
        if (this.config.path) {
            this.dbPath = this.config.path;
            logger.info(`SQLite using custom path: ${this.dbPath}`);
        } else {
            // Use agent-specific database filename or fall back to default
            const defaultFilename = this.agentId ? `${this.agentId}.db` : 'dexto.db';
            this.dbPath = this.resolveDefaultPath(this.config.database || defaultFilename);
        }

        // Ensure directory exists
        const dir = dirname(this.dbPath);
        logger.debug(`SQLite ensuring directory exists: ${dir}`);
        try {
            mkdirSync(dir, { recursive: true });
        } catch (error) {
            // Directory might already exist, that's fine
            logger.debug(`Directory creation result: ${error ? 'exists' : 'created'}`);
        }

        // Initialize SQLite database
        const sqliteOptions = this.config.options || {};
        logger.debug(`SQLite initializing database with config:`, {
            readonly: sqliteOptions.readonly || false,
            fileMustExist: sqliteOptions.fileMustExist || false,
            timeout: sqliteOptions.timeout || 5000,
        });

        this.db = new BetterSqlite3Database(this.dbPath, {
            readonly: sqliteOptions.readonly || false,
            fileMustExist: sqliteOptions.fileMustExist || false,
            timeout: sqliteOptions.timeout || 5000,
            verbose: sqliteOptions.verbose
                ? (message?: unknown, ...additionalArgs: unknown[]) => {
                      logger.debug(
                          typeof message === 'string' ||
                              (typeof message === 'object' && message !== null)
                              ? message
                              : String(message),
                          ...additionalArgs
                      );
                  }
                : undefined,
        });

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        logger.debug('SQLite enabled WAL mode for better concurrency');

        // Create tables if they don't exist
        this.initializeTables();

        logger.info(`✅ SQLite store successfully connected to: ${this.dbPath}`);
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    isConnected(): boolean {
        return this.db !== null;
    }

    getStoreType(): string {
        return 'sqlite';
    }

    // Core operations
    async get<T>(key: string): Promise<T | undefined> {
        this.checkConnection();
        try {
            const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as
                | { value: string }
                | undefined;
            return row ? JSON.parse(row.value) : undefined;
        } catch (error) {
            throw StorageError.readFailed(
                'get',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.checkConnection();
        try {
            const serialized = JSON.stringify(value);
            this.db
                .prepare(
                    'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)'
                )
                .run(key, serialized, Date.now());
        } catch (error) {
            throw StorageError.writeFailed(
                'set',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async delete(key: string): Promise<void> {
        this.checkConnection();
        try {
            this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
            this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
        } catch (error) {
            throw StorageError.deleteFailed(
                'delete',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    // List operations
    async list(prefix: string): Promise<string[]> {
        this.checkConnection();
        try {
            // Get keys from both tables
            const kvKeys = this.db
                .prepare('SELECT key FROM kv_store WHERE key LIKE ?')
                .all(`${prefix}%`) as { key: string }[];
            const listKeys = this.db
                .prepare('SELECT DISTINCT key FROM list_store WHERE key LIKE ?')
                .all(`${prefix}%`) as { key: string }[];

            const allKeys = new Set([
                ...kvKeys.map((row) => row.key),
                ...listKeys.map((row) => row.key),
            ]);

            return Array.from(allKeys).sort();
        } catch (error) {
            throw StorageError.readFailed(
                'list',
                error instanceof Error ? error.message : String(error),
                { prefix }
            );
        }
    }

    async append<T>(key: string, item: T): Promise<void> {
        this.checkConnection();
        try {
            const serialized = JSON.stringify(item);

            // Use atomic subquery to calculate next sequence and insert in single statement
            // This eliminates race conditions under WAL mode
            this.db
                .prepare(
                    'INSERT INTO list_store (key, value, sequence) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM list_store WHERE key = ?))'
                )
                .run(key, serialized, key);
        } catch (error) {
            throw StorageError.writeFailed(
                'append',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        this.checkConnection();
        try {
            const rows = this.db
                .prepare(
                    'SELECT value FROM list_store WHERE key = ? ORDER BY sequence ASC LIMIT ? OFFSET ?'
                )
                .all(key, count, start) as { value: string }[];

            return rows.map((row) => JSON.parse(row.value));
        } catch (error) {
            throw StorageError.readFailed(
                'getRange',
                error instanceof Error ? error.message : String(error),
                { key, start, count }
            );
        }
    }

    // Schema management

    private checkConnection(): void {
        if (!this.db) {
            throw StorageError.notConnected('SQLiteStore');
        }
    }

    // Maintenance operations
    async vacuum(): Promise<void> {
        this.checkConnection();
        this.db.exec('VACUUM');
    }

    async getStats(): Promise<{
        kvCount: number;
        listCount: number;
        dbSize: number;
    }> {
        this.checkConnection();

        const kvCount = this.db.prepare('SELECT COUNT(*) as count FROM kv_store').get() as {
            count: number;
        };
        const listCount = this.db.prepare('SELECT COUNT(*) as count FROM list_store').get() as {
            count: number;
        };
        const dbSize = this.db
            .prepare(
                'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()'
            )
            .get() as { size: number };

        return {
            kvCount: kvCount.count,
            listCount: listCount.count,
            dbSize: dbSize.size,
        };
    }
}
