import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type { Database } from './types.js';
import type { Logger } from '@dexto/core';
import { DextoLogComponent, StorageError } from '@dexto/core';
import type { SqliteDatabaseConfig } from './schemas.js';

type SqliteStatement = {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
};

type SqliteDriver = {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
};

type SqliteDatabaseConstructor = new (filename: string, options?: unknown) => SqliteDriver;

// Dynamic import for bun:sqlite / better-sqlite3 (Node fallback)
let BunSqliteDatabase: SqliteDatabaseConstructor | undefined;
let BetterSqlite3Database: SqliteDatabaseConstructor | undefined;

/**
 * SQLite database store for local development and production.
 * Implements the Database interface with proper schema and connection handling.
 */
export class SQLiteStore implements Database {
    private db: SqliteDriver | null = null;
    private dbPath: string;
    private config: SqliteDatabaseConfig;
    private logger: Logger;

    constructor(config: SqliteDatabaseConfig, logger: Logger) {
        this.config = config;
        // Path is provided via CLI enrichment
        this.dbPath = '';
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    private initializeTables(): void {
        const db = this.getDb();
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
        const readonly = sqliteOptions['readonly'] === true;
        const fileMustExist = sqliteOptions['fileMustExist'] === true;
        const timeout =
            typeof sqliteOptions['timeout'] === 'number' ? sqliteOptions['timeout'] : 5000;
        const verbose = sqliteOptions['verbose'] === true;

        const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
        const runtime = isBunRuntime ? 'bun' : 'node';

        this.logger.debug(`SQLite initializing database with config:`, {
            runtime,
            readonly,
            fileMustExist,
            timeout,
            verbose,
        });

        if (isBunRuntime) {
            if (!BunSqliteDatabase) {
                try {
                    const module = await import('bun:sqlite');
                    BunSqliteDatabase = (
                        module as unknown as { Database: SqliteDatabaseConstructor }
                    ).Database;
                } catch (error: unknown) {
                    throw StorageError.connectionFailed(
                        `Failed to import bun:sqlite: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            // bun:sqlite does not support better-sqlite3-style `timeout`/`verbose` constructor options.
            // If we need timeout-like behavior, we should use `PRAGMA busy_timeout = ...` instead.
            this.db = new BunSqliteDatabase(this.dbPath, {
                readonly,
                create: !fileMustExist,
            });
        } else {
            if (!BetterSqlite3Database) {
                try {
                    const module = await import('better-sqlite3');
                    BetterSqlite3Database = ((module as unknown as { default?: unknown }).default ||
                        module) as SqliteDatabaseConstructor;
                } catch (error: unknown) {
                    const err = error as NodeJS.ErrnoException;
                    if (err.code === 'ERR_MODULE_NOT_FOUND') {
                        throw StorageError.dependencyNotInstalled(
                            'SQLite',
                            'better-sqlite3',
                            'npm install better-sqlite3 (or: bun add better-sqlite3)'
                        );
                    }
                    throw StorageError.connectionFailed(
                        `Failed to import better-sqlite3: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            this.db = new BetterSqlite3Database(this.dbPath, {
                readonly,
                fileMustExist,
                timeout,
                verbose: verbose
                    ? (message?: unknown, ...additionalArgs: unknown[]) => {
                          const messageStr =
                              typeof message === 'string'
                                  ? message
                                  : typeof message === 'object' && message !== null
                                    ? JSON.stringify(message)
                                    : String(message);
                          this.logger.debug(
                              messageStr,
                              additionalArgs.length > 0 ? { args: additionalArgs } : undefined
                          );
                      }
                    : undefined,
            });
        }

        const db = this.getDb();

        // Enable WAL mode for better concurrency (works for both bun:sqlite and better-sqlite3)
        db.exec('PRAGMA journal_mode = WAL');
        this.logger.debug('SQLite enabled WAL mode for better concurrency');

        // Create tables if they don't exist
        this.initializeTables();

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
        const db = this.getDb();
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
        const db = this.getDb();
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

    async delete(key: string): Promise<void> {
        const db = this.getDb();
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
        const db = this.getDb();
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
        const db = this.getDb();
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

    async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
        const db = this.getDb();
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

    private getDb(): SqliteDriver {
        if (!this.db) {
            throw StorageError.notConnected('SQLiteStore');
        }

        return this.db;
    }

    // Maintenance operations
    async vacuum(): Promise<void> {
        this.getDb().exec('VACUUM');
    }

    async getStats(): Promise<{
        kvCount: number;
        listCount: number;
        dbSize: number;
    }> {
        const db = this.getDb();

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
