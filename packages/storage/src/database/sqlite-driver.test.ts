import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    openSqlite,
    openSqliteWith,
    type SqliteConnection,
    type SqliteDriverName,
    type SqliteOpenOptions,
} from './sqlite-driver.js';

const WRITE: SqliteOpenOptions = { readonly: false, fileMustExist: false, timeoutMs: 1000 };
const nodeMajor = Number(process.versions.node.split('.')[0]);

let dir: string;
const open: SqliteConnection[] = [];

beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dexto-sqlite-driver-'));
});

afterEach(async () => {
    for (const connection of open.splice(0)) connection.close();
    await rm(dir, { recursive: true, force: true });
});

async function connect(
    driver: SqliteDriverName,
    file: string,
    options: SqliteOpenOptions
): Promise<SqliteConnection> {
    const connection = await openSqliteWith(driver, file, options);
    if (connection === null) throw new Error(`${driver} does not load on this Node.js`);
    open.push(connection);
    return connection;
}

// Both drivers must behave the same: the dexto CLI gets whichever installs on the person's Node.js.
describe.each(['better-sqlite3', 'node:sqlite'] as const)('%s', (driver) => {
    it.skipIf(driver === 'node:sqlite' && nodeMajor < 22)(
        'reads back what it writes, and keeps it across a reopen',
        async () => {
            const file = path.join(dir, 'db.sqlite');
            const db = await connect(driver, file, WRITE);
            expect(db.driver).toBe(driver);
            db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
            db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('a', '1');
            expect(db.prepare('SELECT value FROM kv WHERE key = ?').get('a')).toEqual({
                value: '1',
            });
            expect(db.prepare('SELECT value FROM kv WHERE key = ?').get('missing')).toBeUndefined();
            db.close();
            open.splice(open.indexOf(db), 1);

            const again = await connect(driver, file, {
                readonly: true,
                fileMustExist: true,
                timeoutMs: 1000,
            });
            expect(again.prepare('SELECT key, value FROM kv').all()).toEqual([
                { key: 'a', value: '1' },
            ]);
            expect(() => again.prepare('INSERT INTO kv VALUES (?, ?)').run('b', '2')).toThrow();
        }
    );

    it.skipIf(driver === 'node:sqlite' && nodeMajor < 22)(
        'commits a transaction that returns and rolls back one that throws',
        async () => {
            const db = await connect(driver, path.join(dir, 'tx.sqlite'), WRITE);
            db.exec('CREATE TABLE items (n INTEGER)');
            const insert = db.prepare('INSERT INTO items (n) VALUES (?)');

            expect(db.transaction(() => (insert.run(1), insert.run(2), 'done'))()).toBe('done');
            expect(() =>
                db.transaction(() => {
                    insert.run(3);
                    throw new Error('stop');
                })()
            ).toThrow('stop');

            expect(db.prepare('SELECT n FROM items ORDER BY n').all()).toEqual([
                { n: 1 },
                { n: 2 },
            ]);
        }
    );

    it.skipIf(driver === 'node:sqlite' && nodeMajor < 22)(
        'refuses a missing file when it must exist, without creating it',
        async () => {
            const file = path.join(dir, 'missing.sqlite');
            await expect(
                connect(driver, file, { readonly: true, fileMustExist: true, timeoutMs: 0 })
            ).rejects.toThrow();
            const { existsSync } = await import('node:fs');
            expect(existsSync(file)).toBe(false);
        }
    );
});

describe('openSqlite', () => {
    it('prefers better-sqlite3 where its binary loads', async () => {
        const db = await openSqlite(path.join(dir, 'pick.sqlite'), WRITE);
        open.push(db);
        expect(db.driver).toBe('better-sqlite3');
    });
});
