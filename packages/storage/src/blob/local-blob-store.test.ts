import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '@dexto/core';
import { MemoryBlobStore } from './memory-blob-store.js';
import { LocalBlobStore } from './local-blob-store.js';
import { parseBlobReference } from './reference.js';

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

const unsafeReferences = [
    '../outside',
    'blob:../../etc/passwd',
    'a/b',
    'blob:..\\windows',
    'ABCDEF0123456789',
    '0123456789abcde',
    '0123456789abcdef0',
    'blob:',
    'not-a-hash!!!!!!',
];

describe('parseBlobReference', () => {
    it.each(['0123456789abcdef', 'blob:0123456789abcdef'])('accepts %s', (reference) => {
        expect(parseBlobReference(reference)).toBe('0123456789abcdef');
    });

    it.each(['', ...unsafeReferences])('rejects %j', (reference) => {
        expect(() => parseBlobReference(reference)).toThrow(/invalid/i);
    });
});

describe('LocalBlobStore blob ids', () => {
    let directory: string;
    let store: LocalBlobStore;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'dexto-blob-'));
        store = new LocalBlobStore(
            {
                type: 'local',
                storePath: path.join(directory, 'blobs'),
                maxBlobSize: 1024 * 1024,
                maxTotalSize: 10 * 1024 * 1024,
                cleanupAfterDays: 30,
            },
            createLogger()
        );
        await store.connect();
    });

    afterEach(async () => {
        await store.disconnect();
        await rm(directory, { recursive: true, force: true });
    });

    it('round-trips a stored blob by its reference', async () => {
        const reference = await store.store(Buffer.from('hello'), { mimeType: 'text/plain' });

        await expect(store.exists(reference.uri)).resolves.toBe(true);
        await expect(store.retrieve(reference.uri, 'buffer')).resolves.toMatchObject({
            format: 'buffer',
        });
    });

    it.each(unsafeReferences)('rejects %j without touching the filesystem', async (reference) => {
        await writeFile(path.join(directory, 'outside.dat'), 'x');
        await writeFile(path.join(directory, 'outside.meta.json'), '{}');
        const before = await readdir(directory);

        await expect(store.exists(reference)).rejects.toThrow(/invalid/i);
        await expect(store.retrieve(reference)).rejects.toThrow(/invalid/i);
        await expect(store.delete(reference)).rejects.toThrow(/invalid/i);

        expect(await readdir(directory)).toEqual(before);
    });

    it('does not delete files outside the store through a crafted id', async () => {
        await writeFile(path.join(directory, 'outside.dat'), 'x');
        await writeFile(path.join(directory, 'outside.meta.json'), '{}');

        await expect(store.delete('blob:../outside')).rejects.toThrow(/invalid/i);

        expect(await readdir(directory)).toContain('outside.dat');
    });
});

describe('MemoryBlobStore blob ids', () => {
    it.each(unsafeReferences)('rejects %j', async (reference) => {
        const store = new MemoryBlobStore(
            { maxBlobSize: 1024, maxTotalSize: 4096 },
            createLogger()
        );
        await store.connect();

        await expect(store.exists(reference)).rejects.toThrow(/invalid/i);
        await expect(store.retrieve(reference)).rejects.toThrow(/invalid/i);
        await expect(store.delete(reference)).rejects.toThrow(/invalid/i);
    });
});
