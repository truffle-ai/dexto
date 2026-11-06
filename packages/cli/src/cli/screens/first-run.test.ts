import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { homeRelative, readGit } from './first-run.js';

describe('homeRelative', () => {
    it('shortens the home folder to ~ on POSIX paths', () => {
        expect(homeRelative('/home/sam', '/home/sam', path.posix)).toBe('~');
        expect(homeRelative('/home/sam/code/acme', '/home/sam', path.posix)).toBe('~/code/acme');
        expect(homeRelative('/home/samuel/code', '/home/sam', path.posix)).toBe(
            '/home/samuel/code'
        );
        expect(homeRelative('/srv/acme', '/home/sam', path.posix)).toBe('/srv/acme');
        expect(homeRelative('/home/sam/..cache', '/home/sam', path.posix)).toBe('~/..cache');
    });

    it('shortens the home folder to ~ on Windows paths', () => {
        const home = 'C:\\Users\\Sam';
        expect(homeRelative('C:\\Users\\Sam', home, path.win32)).toBe('~');
        expect(homeRelative('C:\\Users\\Sam\\code\\acme', home, path.win32)).toBe('~\\code\\acme');
        expect(homeRelative('c:\\users\\sam\\code', home, path.win32)).toBe('~\\code');
        expect(homeRelative('C:\\Users\\Samuel\\code', home, path.win32)).toBe(
            'C:\\Users\\Samuel\\code'
        );
        expect(homeRelative('D:\\work\\acme', home, path.win32)).toBe('D:\\work\\acme');
    });
});

describe('readGit', () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'dexto-first-run-'));
    const repo = mkdtempSync(path.join(os.tmpdir(), 'dexto-first-run-git-'));
    afterAll(() => {
        rmSync(outside, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
    });

    it('reads the branch and the files with changes', async () => {
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
        writeFileSync(path.join(repo, 'a.txt'), 'a');
        writeFileSync(path.join(repo, 'b.txt'), 'b');
        expect(await readGit(repo)).toEqual({ branch: 'main', uncommitted: 2 });
    });

    it('is null where git cannot answer', async () => {
        expect(await readGit(path.join(outside, 'missing'))).toBeNull();
    });

    it('gives up at its deadline instead of waiting on git', async () => {
        const started = Date.now();
        expect(await readGit(repo, 1)).toBeNull();
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
