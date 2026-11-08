import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertSameFile, copyWithoutFollowingLinks } from './backup-copy.js';

describe('copyWithoutFollowingLinks', () => {
    let dir: string;
    let source: string;
    let destination: string;

    beforeEach(async () => {
        dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-backup-copy-')));
        source = path.join(dir, 'source.txt');
        destination = path.join(dir, 'backup.txt');
        await fs.writeFile(source, 'original');
    });

    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    describe('without O_NOFOLLOW (Windows)', () => {
        const noFollow = undefined;

        it('copies a regular file', async () => {
            await copyWithoutFollowingLinks(source, destination, { noFollow });

            expect(await fs.readFile(destination, 'utf-8')).toBe('original');
        });

        it('refuses a source swapped for a different file after the lstat', async () => {
            const other = path.join(dir, 'other.txt');
            await fs.writeFile(other, 'a different file');

            await expect(
                copyWithoutFollowingLinks(source, destination, {
                    noFollow,
                    beforeOpen: () => fs.rename(other, source),
                })
            ).rejects.toThrow('Source changed while backing up');

            await expect(fs.access(destination)).rejects.toThrow();
        });

        it('refuses the swap even when size and mtime match', async () => {
            const before = await fs.stat(source);
            const other = path.join(dir, 'other.txt');
            await fs.writeFile(other, 'ORIGINAL');
            await fs.utimes(other, before.atime, before.mtime);
            expect((await fs.stat(other)).size).toBe(before.size);
            expect((await fs.stat(other)).mtime.getTime()).toBe(before.mtime.getTime());

            await expect(
                copyWithoutFollowingLinks(source, destination, {
                    noFollow,
                    beforeOpen: () => fs.rename(other, source),
                })
            ).rejects.toThrow('Source changed while backing up');

            await expect(fs.access(destination)).rejects.toThrow();
        });

        it('refuses a symlink source', async () => {
            const link = path.join(dir, 'link.txt');
            await fs.symlink(source, link);

            await expect(
                copyWithoutFollowingLinks(link, destination, { noFollow })
            ).rejects.toThrow('Only regular files can be backed up');
        });
    });

    it('refuses a symlink swapped in after the lstat where O_NOFOLLOW exists', async () => {
        const outside = path.join(dir, 'outside.txt');
        await fs.writeFile(outside, 'outside secret');

        await expect(
            copyWithoutFollowingLinks(source, destination, {
                noFollow: fsConstants.O_NOFOLLOW,
                beforeOpen: async () => {
                    await fs.rm(source);
                    await fs.symlink(outside, source);
                },
            })
        ).rejects.toThrow();

        await expect(fs.access(destination)).rejects.toThrow();
    });
});

describe('assertSameFile', () => {
    it('refuses when O_NOFOLLOW is missing and the lstat reports no inode', () => {
        expect(() => assertSameFile({ dev: 1, ino: 0 }, { dev: 1, ino: 0 }, false)).toThrow(
            /Cannot safely back up on this platform/
        );
    });

    it('refuses when O_NOFOLLOW is missing and the opened file reports no inode', () => {
        expect(() => assertSameFile({ dev: 1, ino: 7 }, { dev: 1, ino: 0 }, false)).toThrow(
            /Cannot safely back up on this platform/
        );
    });

    it('refuses a different inode or device', () => {
        expect(() => assertSameFile({ dev: 1, ino: 7 }, { dev: 1, ino: 8 }, false)).toThrow(
            'Source changed while backing up'
        );
        expect(() => assertSameFile({ dev: 1, ino: 7 }, { dev: 2, ino: 7 }, false)).toThrow(
            'Source changed while backing up'
        );
    });

    it('accepts the same inode and device', () => {
        expect(() => assertSameFile({ dev: 1, ino: 7 }, { dev: 1, ino: 7 }, false)).not.toThrow();
    });
});
