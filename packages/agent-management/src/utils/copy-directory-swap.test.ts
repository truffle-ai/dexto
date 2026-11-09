/**
 * copyDirectory while a path it already looked at is swapped for a link to a folder outside the
 * source. Real directories throughout; a spy runs the swap at one exact point of the copy.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyDirectory } from './path.js';

const MARKER = 'outside-marker-contents';

describe.skipIf(process.platform === 'win32')('copyDirectory with a path swapped mid-copy', () => {
    let tempDir: string;
    let source: string;
    let outside: string;
    let dest: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-copy-swap-'));
        source = path.join(tempDir, 'source');
        outside = path.join(tempDir, 'outside');
        dest = path.join(tempDir, 'dest');
        // The outside folder mirrors the source so a followed link would copy it under real names.
        for (const root of [source, outside]) {
            const content = root === outside ? MARKER : 'inside';
            await fs.mkdir(path.join(root, 'sub'), { recursive: true });
            await fs.writeFile(path.join(root, 'top.txt'), content);
            await fs.writeFile(path.join(root, 'sub', 'nested.txt'), content);
        }
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function swapForOutsideLink(target: string, outsideTarget: string) {
        await fs.rename(target, `${target}.real`);
        await fs.symlink(outsideTarget, target);
    }

    /** Runs `action` just before (`when: 'before'`) or after the first matching call. */
    function atCall(
        method: 'readdir' | 'open' | 'realpath',
        when: 'before' | 'after',
        matches: (target: string) => boolean,
        action: () => Promise<void>
    ) {
        const original = fs[method] as (...args: unknown[]) => Promise<unknown>;
        let done = false;
        vi.spyOn(fs, method as 'readdir').mockImplementation((async (
            target: string,
            ...rest: unknown[]
        ) => {
            const fire = !done && matches(String(target));
            if (fire) done = true;
            if (fire && when === 'before') await action();
            const result = await original.call(fs, target, ...rest);
            if (fire && when === 'after') await action();
            return result;
        }) as never);
    }

    async function copiedContents(): Promise<string[]> {
        const contents: string[] = [];
        const walk = async (dir: string) => {
            for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else contents.push(await fs.readFile(full, 'utf-8'));
            }
        };
        await walk(dest).catch(() => undefined);
        return contents;
    }

    it('aborts when the source root is swapped just after it was resolved', async () => {
        atCall(
            'realpath',
            'after',
            (target) => target === source,
            () => swapForOutsideLink(source, outside)
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow();
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('aborts when the source root is swapped while it is being listed', async () => {
        atCall(
            'readdir',
            'before',
            (target) => target === source,
            () => swapForOutsideLink(source, outside)
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow(/changed while/);
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('aborts when a subdirectory is swapped while it is being listed', async () => {
        atCall(
            'readdir',
            'before',
            (target) => target === path.join(source, 'sub'),
            () => swapForOutsideLink(path.join(source, 'sub'), path.join(outside, 'sub'))
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow(/changed while/);
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('aborts when a subdirectory is swapped just before it is opened', async () => {
        atCall(
            'open',
            'before',
            (target) => target === path.join(source, 'sub'),
            () => swapForOutsideLink(path.join(source, 'sub'), path.join(outside, 'sub'))
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow();
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('does not copy a file swapped for a link after the directory was listed', async () => {
        atCall(
            'readdir',
            'after',
            (target) => target === source,
            () => swapForOutsideLink(path.join(source, 'top.txt'), path.join(outside, 'top.txt'))
        );

        await copyDirectory(source, dest).catch(() => undefined);
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('aborts when a file is swapped for a link just before it is opened', async () => {
        atCall(
            'open',
            'before',
            (target) => target === path.join(source, 'top.txt'),
            () => swapForOutsideLink(path.join(source, 'top.txt'), path.join(outside, 'top.txt'))
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow();
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('aborts when the directory holding a file is swapped just before the file is opened', async () => {
        atCall(
            'open',
            'before',
            (target) => target === path.join(source, 'sub', 'nested.txt'),
            () => swapForOutsideLink(path.join(source, 'sub'), path.join(outside, 'sub'))
        );

        await expect(copyDirectory(source, dest)).rejects.toThrow();
        expect(await copiedContents()).not.toContain(MARKER);
    });

    it('still copies everything when nothing is swapped', async () => {
        await copyDirectory(source, dest);

        expect((await copiedContents()).sort()).toEqual(['inside', 'inside']);
    });
});
