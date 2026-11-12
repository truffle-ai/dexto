import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '@dexto/core';
import { SQLiteStore } from './sqlite-store.js';

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

describe('SQLiteStore', () => {
    let dir: string;
    let store: SQLiteStore;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'dexto-sqlite-store-'));
        store = new SQLiteStore(
            { type: 'sqlite', path: path.join(dir, 'nested', 'db.sqlite') },
            createLogger()
        );
    });

    afterEach(async () => {
        await store.disconnect();
        await rm(dir, { recursive: true, force: true });
    });

    // better-sqlite3 12.10 is the first release with prebuilt binaries for Node.js 26; 12.9 has
    // none, so npm would compile it from source and fail on a machine without a compiler.
    it('uses a better-sqlite3 release with prebuilt binaries for Node.js 22, 24 and 26', () => {
        const require = createRequire(import.meta.url);
        const { version } = require('better-sqlite3/package.json') as { version: string };
        const [major, minor] = version.split('.').map(Number);
        expect(major).toBe(12);
        expect(minor).toBeGreaterThanOrEqual(10);
    });

    it('creates its folder and keeps values and lists across a reconnect', async () => {
        await store.connect();
        await store.set('chat:1', { title: 'hello', turns: 2 });
        await store.append('messages:1', { role: 'user', text: 'hi' });
        await store.append('messages:1', { role: 'assistant', text: 'hello' });
        await store.disconnect();

        await store.connect();
        expect(await store.get('chat:1')).toEqual({ title: 'hello', turns: 2 });
        expect(await store.getRange('messages:1', 0, 10)).toEqual([
            { role: 'user', text: 'hi' },
            { role: 'assistant', text: 'hello' },
        ]);
        expect(await store.list('chat:')).toEqual(['chat:1']);

        await store.delete('chat:1');
        expect(await store.get('chat:1')).toBeUndefined();
    });
});
