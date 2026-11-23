import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeOverStaleLock, withRefreshLock } from './refresh-lock.js';

describe('refresh lock', () => {
    let dir: string;
    let lock: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'dexto-refresh-lock-'));
        lock = path.join(dir, 'default.refresh.lock');
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('removes the stale lock it moved aside', async () => {
        await writeFile(lock, 'crashed-owner');

        await takeOverStaleLock(lock, 'crashed-owner');

        await expect(readdir(dir)).resolves.toEqual([]);
    });

    it('puts back a live lock another process took over after the stale one was read', async () => {
        // The stale lock was read, then another process took it over first: the path now holds
        // that process's lock.
        await writeFile(lock, 'live-owner');

        await takeOverStaleLock(lock, 'crashed-owner');

        await expect(readFile(lock, 'utf8')).resolves.toBe('live-owner');
        await expect(readdir(dir)).resolves.toEqual(['default.refresh.lock']);
    });

    it('takes over at once a lock whose process on this machine is gone', async () => {
        await writeFile(lock, `${os.hostname()} 2147483646 dead-owner`);
        const started = Date.now();

        await expect(withRefreshLock(lock, async () => 'refreshed')).resolves.toBe('refreshed');

        expect(Date.now() - started).toBeLessThan(1_000);
        await expect(readdir(dir)).resolves.toEqual([]);
    });

    it('takes over a lock older than the stale window', async () => {
        await writeFile(lock, 'other-machine 1 old-owner');
        const old = new Date(Date.now() - 60_000);
        await utimes(lock, old, old);

        await expect(withRefreshLock(lock, async () => 'refreshed')).resolves.toBe('refreshed');
        await expect(readdir(dir)).resolves.toEqual([]);
    });
});
