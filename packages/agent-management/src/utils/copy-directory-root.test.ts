import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyDirectory } from './path.js';

describe.skipIf(process.platform === 'win32')('copyDirectory with a linked source root', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-copy-root-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('refuses a source directory that is a symlink and copies nothing', async () => {
        const outside = path.join(tempDir, 'outside');
        const src = path.join(tempDir, 'plugin');
        const dest = path.join(tempDir, 'dest');
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, 'id_rsa'), 'private contents');
        await fs.symlink(outside, src);

        await expect(copyDirectory(src, dest)).rejects.toThrow(/symbolic link/);
        await expect(fs.readdir(dest)).rejects.toThrow();
    });

    it('still copies a real directory, even when its parent path goes through a link', async () => {
        const real = path.join(tempDir, 'real');
        await fs.mkdir(path.join(real, 'plugin'), { recursive: true });
        await fs.writeFile(path.join(real, 'plugin', 'a.txt'), 'hello');
        await fs.symlink(real, path.join(tempDir, 'via-link'));
        const dest = path.join(tempDir, 'dest');

        await copyDirectory(path.join(tempDir, 'via-link', 'plugin'), dest);

        expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf-8')).toBe('hello');
    });
});
