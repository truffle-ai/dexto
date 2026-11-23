// A lock file beside a saved login, so only one process at a time refreshes its rotating refresh
// token. The lock names its holder (machine, process and a random id); only that holder releases
// it, and a lock is taken over only once its process is gone or it has outlived every refresh.

import { randomUUID } from 'node:crypto';
import { link, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Well past the 10 s every refresh is bounded by, so only a crashed process's lock is this old. */
const REFRESH_LOCK_STALE_MS = 30_000;
/** No shorter than the stale window, so a crashed process's lock is taken over, not waited out. */
const REFRESH_LOCK_WAIT_MS = REFRESH_LOCK_STALE_MS + 5_000;
const REFRESH_LOCK_POLL_MS = 50;

/** Runs `work` holding the lock, taking over one a crashed process left behind. */
export async function withRefreshLock<T>(lock: string, work: () => Promise<T>): Promise<T> {
    const owner = `${os.hostname()} ${process.pid} ${randomUUID()}`;
    const deadline = Date.now() + REFRESH_LOCK_WAIT_MS;
    await mkdir(path.dirname(lock), { mode: 0o700, recursive: true });
    for (;;) {
        await writeFile(lock, owner, { flag: 'wx', mode: 0o600 }).catch((error: unknown) => {
            if (!hasCode(error, 'EEXIST')) throw error;
        });
        const held = await readLock(lock);
        if (held?.owner === owner) break;
        if (held !== null && isStale(held)) {
            await takeOverStaleLock(lock, held.owner);
            continue;
        }
        if (Date.now() > deadline)
            throw new Error(`Another dexto process is still refreshing this sign-in (${lock}).`);
        await new Promise((resolve) => setTimeout(resolve, REFRESH_LOCK_POLL_MS));
    }
    try {
        return await work();
    } finally {
        if ((await readLock(lock))?.owner === owner) await rm(lock, { force: true });
    }
}

/**
 * Moves the lock aside atomically, so of several processes taking over one stale lock only one
 * removes it. Holder ids are unique, so a moved lock that names another holder is one a process
 * took over after `staleOwner` was read, and goes back.
 */
export async function takeOverStaleLock(lock: string, staleOwner: string): Promise<void> {
    const moved = `${lock}.${randomUUID()}`;
    try {
        await rename(lock, moved);
    } catch (error) {
        if (hasCode(error, 'ENOENT')) return;
        throw error;
    }
    if ((await readLock(moved))?.owner !== staleOwner) {
        await link(moved, lock).catch((error: unknown) => {
            if (!hasCode(error, 'EEXIST')) throw error;
        });
    }
    await rm(moved, { force: true });
}

/** The holder and age of one lock file, both read from the same open file. */
async function readLock(lock: string): Promise<{ owner: string; modifiedAt: number } | null> {
    let handle;
    try {
        handle = await open(lock, 'r');
    } catch (error) {
        if (hasCode(error, 'ENOENT')) return null;
        throw error;
    }
    try {
        const [owner, held] = await Promise.all([handle.readFile('utf8'), handle.stat()]);
        return { owner, modifiedAt: held.mtimeMs };
    } finally {
        await handle.close();
    }
}

function isStale(held: { owner: string; modifiedAt: number }): boolean {
    if (Date.now() - held.modifiedAt > REFRESH_LOCK_STALE_MS) return true;
    const [host, pid] = held.owner.split(' ');
    return host === os.hostname() && Number.isInteger(Number(pid)) && !processIsAlive(Number(pid));
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !hasCode(error, 'ESRCH');
    }
}

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && 'code' in error && error.code === code;
}
