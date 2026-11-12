import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type { Database } from './types.js';
import type { Logger } from '@dexto/core';
import { DextoLogComponent, DextoRuntimeError, StorageError } from '@dexto/core';
import type { SqliteDatabaseConfig } from './schemas.js';
import { openSqlite, type SqliteConnection } from './sqlite-driver.js';

/**
 * SQLite database store for local development and production.
 * Implements the Database interface with proper schema and connection handling.
 */
export class SQLiteStore implements Database {
    private db: SqliteConnection | null = null;
    private dbPath: string;
    private config: SqliteDatabaseConfig;
    private logger: Logger;

    constructor(config: SqliteDatabaseConfig, logger: Logger) {
        this.config = config;
        // Path is provided via CLI enrichment
        this.dbPath = '';
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    private initializeTables(db: SqliteConnection): void {
        this.logger.debug('SQLite initializing database schema...');

        try {
            // Create key-value table
            db.exec(`
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `);

            // Create list table for append operations
            db.exec(`
                CREATE TABLE IF NOT EXISTS list_store (
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    sequence INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (key, sequence)
                )
            `);

            // Create indexes for better performance
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_kv_store_key ON kv_store(key);
                CREATE INDEX IF NOT EXISTS idx_list_store_key ON list_store(key);
                CREATE INDEX IF NOT EXISTS idx_list_store_sequence ON list_store(key, sequence);
            `);

            this.logger.debug(
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
        if (this.db) return;

        // Initialize database path from config (full path is provided via enrichment)
        this.dbPath = this.config.path;

        this.logger.info(`SQLite using database file: ${this.dbPath}`);

        // Ensure directory exists
        const dir = dirname(this.dbPath);
        this.logger.debug(`SQLite ensuring directory exists: ${dir}`);
        try {
            mkdirSync(dir, { recursive: true });
        } catch (error) {
            // Directory might already exist, that's fine
            this.logger.debug(`Directory creation result: ${error ? 'exists' : 'created'}`);
        }

        const sqliteOptions = this.config.options || {};
        const options = {
            readonly: sqliteOptions.readonly === true,
            fileMustExist: sqliteOptions.fileMustExist === true,
            timeoutMs: typeof sqliteOptions.timeout === 'number' ? sqliteOptions.timeout : 5000,
        };
        this.logger.debug('SQLite opening database', options);
        try {
            this.db = await openSqlite(this.dbPath, options);
        } catch (error) {
            if (error instanceof DextoRuntimeError) throw error;
            throw StorageError.connectionFailed(
                `Failed to open SQLite database: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        this.logger.debug(`SQLite driver: ${this.db.driver}`);

        // Enable WAL mode for better concurrency
        this.db.exec('PRAGMA journal_mode = WAL');
        this.logger.debug('SQLite enabled WAL mode for better concurrency');

        // Create tables if they don't exist
        this.initializeTables(this.db);

        this.logger.info(`✅ SQLite store successfully connected to: ${this.dbPath}`);
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
        const db = this.connection();
        try {
            const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as
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
        const db = this.connection();
        try {
            const serialized = JSON.stringify(value);
            db.prepare(
                'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)'
            ).run(key, serialized, Date.now());
        } catch (error) {
            throw StorageError.writeFailed(
                'set',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async setIfAbsent<T>(key: string, value: T): Promise<{ value: T; inserted: boolean }> {
        const db = this.connection();
        try {
            const serialized = JSON.stringify(value);
            const result = db
                .prepare('INSERT OR IGNORE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)')
                .run(key, serialized, Date.now());

            const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as
                | { value: string }
                | undefined;
            return {
                value: row ? JSON.parse(row.value) : value,
                inserted: result.changes > 0,
            };
        } catch (error) {
            throw StorageError.writeFailed(
                'setIfAbsent',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async delete(key: string): Promise<void> {
        const db = this.connection();
        try {
            db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
            db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
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
        const db = this.connection();
        try {
            // Get keys from both tables
            const kvKeys = db
                .prepare('SELECT key FROM kv_store WHERE key LIKE ?')
                .all(`${prefix}%`) as { key: string }[];
            const listKeys = db
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
        const db = this.connection();
        try {
            const serialized = JSON.stringify(item);

            // Use atomic subquery to calculate next sequence and insert in single statement
            // This eliminates race conditions under WAL mode
            db.prepare(
                'INSERT INTO list_store (key, value, sequence) VALUES (?, ?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM list_store WHERE key = ?))'
            ).run(key, serialized, key);
        } catch (error) {
            throw StorageError.writeFailed(
                'append',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async updateList<T, R>(
        key: string,
        updater: (items: T[]) => { items: T[]; result: R }
    ): Promise<R> {
        const db = this.connection();
        try {
            const transaction = db.transaction(() => {
                const rows = db
                    .prepare('SELECT value FROM list_store WHERE key = ? ORDER BY sequence ASC')
                    .all(key) as { value: string }[];
                const current = rows.map((row) => JSON.parse(row.value)) as T[];
                const mutation = updater(current);

                db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
                if (mutation.items.length > 0) {
                    const insert = db.prepare(
                        'INSERT INTO list_store (key, value, sequence) VALUES (?, ?, ?)'
                    );
                    for (const [index, item] of mutation.items.entries()) {
                        insert.run(key, JSON.stringify(item), index + 1);
                    }
                }

                return mutation.result;
            });

            return transaction();
        } catch (error) {
            throw StorageError.writeFailed(
                'updateList',
                error instanceof Error ? error.message : String(error),
                { key }
            );
        }
    }

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        const db = this.connection();
        try {
            const rows = db
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

    private connection(): SqliteConnection {
        if (!this.db) {
            throw StorageError.notConnected('SQLiteStore');
        }
        return this.db;
    }

    // Maintenance operations
    async vacuum(): Promise<void> {
        const db = this.connection();
        db.exec('VACUUM');
    }

    async getStats(): Promise<{
        kvCount: number;
        listCount: number;
        dbSize: number;
    }> {
        const db = this.connection();

        const kvCount = db.prepare('SELECT COUNT(*) as count FROM kv_store').get() as {
            count: number;
        };
        const listCount = db.prepare('SELECT COUNT(*) as count FROM list_store').get() as {
            count: number;
        };
        const dbSize = db
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
