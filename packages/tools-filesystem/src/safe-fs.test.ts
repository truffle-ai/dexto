/**
 * Symlink containment tests for path canonicalization and file writes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger } from '@dexto/core';
import { canonicalizePath, writeFileNoFollow } from './safe-fs.js';
import { FileSystemService } from './filesystem-service.js';
import { PathValidator } from './path-validator.js';
import { createDirectoryApprovalKey, isPathApprovedByDirectoryKey } from './directory-approval.js';
import type { FileSystemConfig } from './types.js';

const createMockLogger = (): Logger => {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };
    return logger;
};

const describeSymlinks = process.platform === 'win32' ? describe.skip : describe;

describeSymlinks('symlink containment', () => {
    let root: string;
    let allowed: string;
    let outside: string;

    const config = (allowedPaths: string[] = [allowed]): FileSystemConfig => ({
        allowedPaths,
        blockedPaths: [],
        blockedExtensions: [],
        maxFileSize: 10 * 1024 * 1024,
        workingDirectory: allowed,
        enableBackups: false,
        backupRetentionDays: 7,
    });

    const listOutside = async () => (await fs.readdir(outside, { recursive: true })).sort();

    beforeEach(async () => {
        root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-safe-fs-')));
        allowed = path.join(root, 'allowed');
        outside = path.join(root, 'outside');
        await fs.mkdir(allowed);
        await fs.mkdir(outside);
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    describe('canonicalizePath', () => {
        it('returns realpath for existing paths', async () => {
            await fs.symlink(outside, path.join(allowed, 'link'));
            expect(await canonicalizePath(path.join(allowed, 'link'))).toBe(outside);
        });

        it('resolves the nearest existing ancestor for missing paths', async () => {
            await fs.symlink(outside, path.join(allowed, 'link'));
            expect(await canonicalizePath(path.join(allowed, 'link', 'a', 'b.txt'))).toBe(
                path.join(outside, 'a', 'b.txt')
            );
        });

        it('follows dangling symlinks, including relative ones', async () => {
            await fs.symlink(path.join(outside, 'missing.txt'), path.join(allowed, 'abs'));
            await fs.symlink('../outside/rel.txt', path.join(allowed, 'rel'));
            expect(await canonicalizePath(path.join(allowed, 'abs'))).toBe(
                path.join(outside, 'missing.txt')
            );
            expect(await canonicalizePath(path.join(allowed, 'rel'))).toBe(
                path.join(outside, 'rel.txt')
            );
        });

        it('follows chains of dangling symlinks', async () => {
            await fs.symlink(path.join(outside, 'end.txt'), path.join(allowed, 'b'));
            await fs.symlink(path.join(allowed, 'b'), path.join(allowed, 'a'));
            expect(await canonicalizePath(path.join(allowed, 'a'))).toBe(
                path.join(outside, 'end.txt')
            );
        });

        it('rejects symlink loops', async () => {
            await fs.symlink(path.join(allowed, 'loop-b'), path.join(allowed, 'loop-a'));
            await fs.symlink(path.join(allowed, 'loop-a'), path.join(allowed, 'loop-b'));
            await expect(canonicalizePath(path.join(allowed, 'loop-a', 'x'))).rejects.toThrow();
        });
    });

    describe('PathValidator', () => {
        it('rejects new paths that resolve outside through a directory symlink', async () => {
            await fs.symlink(outside, path.join(allowed, 'link'));
            const validator = new PathValidator(config(), createMockLogger());
            const result = await validator.validatePath('link/new.txt', 'write');
            expect(result.isValid).toBe(false);
        });

        it('rejects dangling symlinks that point outside', async () => {
            await fs.symlink(path.join(outside, 'x.txt'), path.join(allowed, 'dangling'));
            const validator = new PathValidator(config(), createMockLogger());
            expect((await validator.validatePath('dangling', 'write')).isValid).toBe(false);
            expect(await validator.isPathWithinAllowed('dangling')).toBe(false);
        });

        it('accepts new files under an allowed root reached through a symlink', async () => {
            const linkedRoot = path.join(root, 'linked-root');
            await fs.symlink(allowed, linkedRoot);
            const validator = new PathValidator(config([linkedRoot]), createMockLogger());
            const result = await validator.validatePath(path.join(linkedRoot, 'new.txt'), 'write');
            expect(result.isValid).toBe(true);
            expect(result.normalizedPath).toBe(path.join(allowed, 'new.txt'));
        });

        it('rejects paths that a blocked path matches only lexically', async () => {
            await fs.mkdir(path.join(allowed, 'real-secret'));
            await fs.symlink(path.join(allowed, 'real-secret'), path.join(allowed, 'secret'));
            const validator = new PathValidator(
                { ...config(), blockedPaths: [path.join(allowed, 'secret')] },
                createMockLogger()
            );
            expect((await validator.validatePath('secret/new.txt', 'write')).isValid).toBe(false);
        });
    });

    describe('FileSystemService writes', () => {
        it('does not create files outside through a directory symlink', async () => {
            await fs.symlink(outside, path.join(allowed, 'link'));
            const service = new FileSystemService(config(), createMockLogger());

            await expect(service.writeFile('link/new.txt', 'x')).rejects.toThrow();
            await expect(service.writeFile('link/sub/deep.txt', 'x')).rejects.toThrow();
            expect(await listOutside()).toEqual([]);
        });

        it('does not create files outside through a dangling symlink', async () => {
            await fs.symlink(path.join(outside, 'x.txt'), path.join(allowed, 'dangling'));
            const service = new FileSystemService(config(), createMockLogger());

            await expect(service.writeFile('dangling', 'x')).rejects.toThrow();
            expect(await listOutside()).toEqual([]);
        });

        it('writes the target of a dangling symlink that stays inside', async () => {
            await fs.mkdir(path.join(allowed, 'sub'));
            await fs.symlink(path.join(allowed, 'sub', 'target.txt'), path.join(allowed, 'link'));
            const service = new FileSystemService(config(), createMockLogger());

            const result = await service.writeFile('link', 'inside');
            expect(result.path).toBe(path.join(allowed, 'sub', 'target.txt'));
            expect(await fs.readFile(path.join(allowed, 'sub', 'target.txt'), 'utf-8')).toBe(
                'inside'
            );
        });

        it('does not edit files outside through a symlink', async () => {
            await fs.writeFile(path.join(outside, 'f.txt'), 'old');
            await fs.symlink(path.join(outside, 'f.txt'), path.join(allowed, 'f.txt'));
            const service = new FileSystemService(config(), createMockLogger());

            await expect(
                service.editFile('f.txt', { oldString: 'old', newString: 'new' })
            ).rejects.toThrow();
            expect(await fs.readFile(path.join(outside, 'f.txt'), 'utf-8')).toBe('old');
        });

        it('still writes and overwrites regular files inside allowed paths', async () => {
            const service = new FileSystemService(config(), createMockLogger());
            await service.writeFile('dir/a.txt', 'first');
            await service.writeFile('dir/a.txt', 'second');
            expect(await fs.readFile(path.join(allowed, 'dir', 'a.txt'), 'utf-8')).toBe('second');
        });
    });

    describe('writeFileNoFollow (path swapped after validation)', () => {
        const insideAllowed = (candidate: string) => {
            const relative = path.relative(allowed, candidate);
            return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
        };

        it('refuses when the final component became a symlink', async () => {
            await fs.writeFile(path.join(outside, 'victim.txt'), 'original');
            const target = path.join(allowed, 'file.txt');
            await fs.symlink(path.join(outside, 'victim.txt'), target);

            await expect(
                writeFileNoFollow(target, 'clobbered', 'utf-8', insideAllowed)
            ).rejects.toThrow();
            expect(await fs.readFile(path.join(outside, 'victim.txt'), 'utf-8')).toBe('original');
        });

        it('refuses and does not truncate when a parent directory became a symlink', async () => {
            await fs.writeFile(path.join(outside, 'victim.txt'), 'original');
            const target = path.join(allowed, 'sub', 'victim.txt');
            await fs.symlink(outside, path.join(allowed, 'sub'));

            await expect(
                writeFileNoFollow(target, 'clobbered', 'utf-8', insideAllowed)
            ).rejects.toThrow(/changed during/);
            expect(await fs.readFile(path.join(outside, 'victim.txt'), 'utf-8')).toBe('original');
        });

        it('truncates existing content on a normal overwrite', async () => {
            const target = path.join(allowed, 'f.txt');
            await fs.writeFile(target, 'a much longer original');
            await writeFileNoFollow(target, 'short', 'utf-8', insideAllowed);
            expect(await fs.readFile(target, 'utf-8')).toBe('short');
        });

        it('removes a file it created when post-open verification fails', async () => {
            const target = path.join(allowed, 'new.txt');
            await expect(writeFileNoFollow(target, 'x', 'utf-8', () => false)).rejects.toThrow(
                /changed during/
            );
            await expect(fs.lstat(target)).rejects.toThrow();
        });

        it('does not create directories through a swapped parent', async () => {
            await fs.symlink(outside, path.join(allowed, 'sub'));
            await expect(
                writeFileNoFollow(
                    path.join(allowed, 'sub', 'deeper', 'f.txt'),
                    'x',
                    'utf-8',
                    insideAllowed
                )
            ).rejects.toThrow();
            expect(await listOutside()).toEqual([]);
        });
    });

    describe('roots and blocked paths behind symlinks', () => {
        it('blocks a relative blocked path reached through an alias when the root is behind a symlink', async () => {
            const realBase = path.join(root, 'real');
            await fs.mkdir(path.join(realBase, 'proj', '.git'), { recursive: true });
            await fs.symlink(realBase, path.join(root, 'tmp'));
            const lexicalRoot = path.join(root, 'tmp', 'proj');
            await fs.symlink(
                path.join(realBase, 'proj', '.git'),
                path.join(realBase, 'proj', 'alias')
            );

            const validator = new PathValidator(
                {
                    ...config([lexicalRoot]),
                    workingDirectory: lexicalRoot,
                    blockedPaths: ['.git'],
                },
                createMockLogger()
            );
            expect((await validator.validatePath('.git/config', 'write')).isValid).toBe(false);
            expect((await validator.validatePath('alias/config', 'write')).isValid).toBe(false);
            expect((await validator.validatePath('alias/pre-commit', 'write')).isValid).toBe(false);
            expect((await validator.validatePath('src/new.ts', 'write')).isValid).toBe(true);
        });

        it('does not widen allowed paths when a symlink is planted at a root later', async () => {
            const futureRoot = path.join(root, 'future');
            const validator = new PathValidator(config([futureRoot]), createMockLogger());
            expect(
                (await validator.validatePath(path.join(futureRoot, 'a.txt'), 'write')).isValid
            ).toBe(true);

            await fs.symlink(outside, futureRoot);
            const escaped = await validator.validatePath(path.join(outside, 'x.txt'), 'write');
            expect(escaped.isValid).toBe(false);
            const throughRoot = await validator.validatePath(
                path.join(futureRoot, 'x.txt'),
                'write'
            );
            expect(throughRoot.isValid).toBe(false);
        });

        it('accepts deep new paths (more than 40 levels)', async () => {
            const deep = path.join(...Array.from({ length: 50 }, (_, i) => `d${i}`), 'f.txt');
            const validator = new PathValidator(config(), createMockLogger());
            expect((await validator.validatePath(deep, 'write')).isValid).toBe(true);
        });
    });

    describe('delete and rename act on links themselves', () => {
        it('deletes a dangling symlink that points outside without touching the target', async () => {
            await fs.symlink(path.join(outside, 'missing.txt'), path.join(allowed, 'dangling'));
            const service = new FileSystemService(config(), createMockLogger());
            await service.deletePath('dangling');
            await expect(fs.lstat(path.join(allowed, 'dangling'))).rejects.toThrow();
        });

        it('deletes a symlink, not the file it points to', async () => {
            await fs.writeFile(path.join(allowed, 'target.txt'), 'keep');
            await fs.symlink(path.join(allowed, 'target.txt'), path.join(allowed, 'link'));
            const service = new FileSystemService(config(), createMockLogger());
            await service.deletePath('link');
            expect(await fs.readFile(path.join(allowed, 'target.txt'), 'utf-8')).toBe('keep');
        });

        it('refuses to move a file into a directory symlink that points outside', async () => {
            await fs.writeFile(path.join(allowed, 'f.txt'), 'data');
            await fs.symlink(outside, path.join(allowed, 'link'));
            const service = new FileSystemService(config(), createMockLogger());
            await expect(service.renamePath('f.txt', 'link/f.txt')).rejects.toThrow();
            expect(await listOutside()).toEqual([]);
        });
    });

    describe('directory approval', () => {
        it('matches files under an approved directory reached through a symlink', async () => {
            const linkedDir = path.join(root, 'linked-outside');
            await fs.symlink(outside, linkedDir);
            const canonicalDir = await canonicalizePath(linkedDir);
            const approvals = new Map([
                [createDirectoryApprovalKey(canonicalDir, 'write'), 'session' as const],
            ]);
            const validator = new PathValidator(config(), createMockLogger());
            validator.setDirectoryApprovalChecker((filePath, operation) =>
                isPathApprovedByDirectoryKey(filePath, approvals, undefined, operation)
            );
            const result = await validator.validatePath(path.join(linkedDir, 'new.txt'), 'write');
            expect(result.isValid).toBe(true);
            expect(result.normalizedPath).toBe(path.join(outside, 'new.txt'));
        });
    });
});
