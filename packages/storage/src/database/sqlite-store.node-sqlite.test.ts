import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '@dexto/core';
import { openSqlite } from './sqlite-driver.js';
import { SQLiteStore } from './sqlite-store.js';

// As on a Node.js with no better-sqlite3 prebuild (Node.js 26 for 12.9): npm skipped the optional
// dependency, so importing it fails and the store must run on node:sqlite.
vi.mock('better-sqlite3', () => {
    throw new Error('better-sqlite3 is not installed');
});

const nodeMajor = Number(process.versions.node.split('.')[0]);

function createLogger(): Logger {
    const noop = () => {};
    const logger: Partial<Logger> = {
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        createChild: () => createLogger(),
    };
    return logger as Logger;
}

describe.skipIf(nodeMajor < 22)('SQLiteStore without better-sqlite3', () => {
    let dir: string;
    let store: SQLiteStore;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'dexto-node-sqlite-store-'));
        store = new SQLiteStore(
            { type: 'sqlite', path: path.join(dir, 'db.sqlite') },
            createLogger()
        );
    });

    afterEach(async () => {
        await store.disconnect();
        await rm(dir, { recursive: true, force: true });
    });

    it('opens with node:sqlite', async () => {
        const db = await openSqlite(path.join(dir, 'probe.sqlite'), {
            readonly: false,
            fileMustExist: false,
            timeoutMs: 0,
        });
        expect(db.driver).toBe('node:sqlite');
        db.close();
    });

    it('keeps values and lists across a reconnect, and updates a list in one transaction', async () => {
        await store.connect();
        await store.set('chat:1', { title: 'hello' });
        expect((await store.setIfAbsent('chat:2', { title: 'new' })).inserted).toBe(true);
        await store.append('messages:1', { n: 1 });
        await store.append('messages:1', { n: 2 });
        await store.updateList<{ n: number }, void>('messages:1', (items) => ({
            items: items.map((item) => ({ n: item.n * 10 })),
            result: undefined,
        }));
        await store.disconnect();

        await store.connect();
        expect(await store.get('chat:1')).toEqual({ title: 'hello' });
        expect(await store.getRange('messages:1', 0, 10)).toEqual([{ n: 10 }, { n: 20 }]);
        expect((await store.list('chat:')).sort()).toEqual(['chat:1', 'chat:2']);
        expect((await store.getStats()).kvCount).toBe(2);
    });
});
