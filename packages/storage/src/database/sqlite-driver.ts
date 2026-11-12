// Opens a SQLite file with better-sqlite3 when its native binary loads, and otherwise with the
// SQLite built into Node.js (node:sqlite, Node.js 22.13 and later).
//
// better-sqlite3 ships prebuilt binaries for some Node.js versions only (12.9: Node.js 20, 22 and
// 24). On any other version npm builds it from source, which needs Python and a C++ compiler, so
// the dexto CLI makes it optional: where it did not install, node:sqlite takes over. Node.js 20
// has no node:sqlite, and is covered by better-sqlite3's prebuilt binary.

import { existsSync } from 'node:fs';
import { StorageError } from '@dexto/core';

export type SqliteDriverName = 'better-sqlite3' | 'node:sqlite';

export interface SqliteStatement {
    run(...params: unknown[]): { readonly changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}

/** The part of a SQLite connection Dexto uses, the same on either driver. */
export interface SqliteConnection {
    readonly driver: SqliteDriverName;
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    /** Wraps `work` in one transaction: committed when it returns, rolled back when it throws. */
    transaction<T>(work: () => T): () => T;
    close(): void;
}

export interface SqliteOpenOptions {
    readonly readonly: boolean;
    /** Refuse to create the file when it is missing. */
    readonly fileMustExist: boolean;
    /** How long to wait on a locked database, in milliseconds. */
    readonly timeoutMs: number;
}

type Open = (file: string, options: SqliteOpenOptions) => SqliteConnection;

interface BetterSqliteDatabase {
    exec(sql: string): unknown;
    prepare(sql: string): SqliteStatement;
    transaction<T>(work: () => T): () => T;
    close(): unknown;
}
type BetterSqliteConstructor = new (
    file: string,
    options: { readonly: boolean; fileMustExist: boolean; timeout: number }
) => BetterSqliteDatabase;

interface NodeSqliteDatabase {
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    close(): void;
}
type NodeSqliteConstructor = new (
    file: string,
    options: { readOnly: boolean }
) => NodeSqliteDatabase;

function isConstructor<T>(value: unknown): value is T {
    return typeof value === 'function';
}

/** better-sqlite3's opener, or null when the package or its native binary does not load. */
async function loadBetterSqlite(): Promise<Open | null> {
    let Database: BetterSqliteConstructor;
    try {
        const module: unknown = await import('better-sqlite3');
        const exported: unknown =
            typeof module === 'object' && module !== null && 'default' in module
                ? module.default
                : module;
        if (!isConstructor<BetterSqliteConstructor>(exported)) return null;
        Database = exported;
        // The native binary loads on first open: an in-memory database proves it is usable here.
        new Database(':memory:', { readonly: false, fileMustExist: false, timeout: 0 }).close();
    } catch {
        return null;
    }
    return (file, options) => {
        const db = new Database(file, {
            readonly: options.readonly,
            fileMustExist: options.fileMustExist,
            timeout: options.timeoutMs,
        });
        return {
            driver: 'better-sqlite3',
            exec: (sql) => void db.exec(sql),
            prepare: (sql) => db.prepare(sql),
            transaction: (work) => db.transaction(work),
            close: () => void db.close(),
        };
    };
}

/** node:sqlite's opener, or null on a Node.js without it. */
async function loadNodeSqlite(): Promise<Open | null> {
    let DatabaseSync: NodeSqliteConstructor;
    try {
        // A variable keeps bundlers and older Node.js type definitions from resolving it.
        const specifier = 'node:sqlite';
        const module: unknown = await import(specifier);
        const exported: unknown =
            typeof module === 'object' && module !== null && 'DatabaseSync' in module
                ? module.DatabaseSync
                : null;
        if (!isConstructor<NodeSqliteConstructor>(exported)) return null;
        DatabaseSync = exported;
    } catch {
        return null;
    }
    return (file, options) => {
        // better-sqlite3 refuses a missing file when asked to; node:sqlite would create it.
        if (options.fileMustExist && file !== ':memory:' && !existsSync(file))
            throw StorageError.connectionFailed(`SQLite database file not found: ${file}`);
        const db = new DatabaseSync(file, { readOnly: options.readonly });
        db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(options.timeoutMs))}`);
        return {
            driver: 'node:sqlite',
            exec: (sql) => db.exec(sql),
            prepare: (sql) => db.prepare(sql),
            transaction:
                <T>(work: () => T) =>
                (): T => {
                    db.exec('BEGIN');
                    try {
                        const result = work();
                        db.exec('COMMIT');
                        return result;
                    } catch (error) {
                        db.exec('ROLLBACK');
                        throw error;
                    }
                },
            close: () => db.close(),
        };
    };
}

const LOADERS: Readonly<Record<SqliteDriverName, () => Promise<Open | null>>> = {
    'better-sqlite3': loadBetterSqlite,
    'node:sqlite': loadNodeSqlite,
};

const loaded = new Map<SqliteDriverName, Promise<Open | null>>();

function load(driver: SqliteDriverName): Promise<Open | null> {
    let open = loaded.get(driver);
    if (open === undefined) {
        open = LOADERS[driver]();
        loaded.set(driver, open);
    }
    return open;
}

/** Opens `file` with `driver` only; null when that driver does not load on this Node.js. */
export async function openSqliteWith(
    driver: SqliteDriverName,
    file: string,
    options: SqliteOpenOptions
): Promise<SqliteConnection | null> {
    const open = await load(driver);
    return open === null ? null : open(file, options);
}

/** Opens `file` with better-sqlite3, or with node:sqlite where better-sqlite3 does not load. */
export async function openSqlite(
    file: string,
    options: SqliteOpenOptions
): Promise<SqliteConnection> {
    for (const driver of ['better-sqlite3', 'node:sqlite'] as const) {
        const connection = await openSqliteWith(driver, file, options);
        if (connection !== null) return connection;
    }
    throw StorageError.dependencyNotInstalled(
        'SQLite',
        'better-sqlite3',
        'npm install better-sqlite3, or use Node.js 22.13 or later'
    );
}
