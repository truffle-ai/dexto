import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '@dexto/core/workspace';
import { LocalWorkspaceHandleProvider } from './local-workspace-handle-provider.js';

describe('LocalWorkspaceHandleProvider files', () => {
    let base: string;
    let root: string;
    let outside: string;

    beforeEach(async () => {
        base = await mkdtemp(path.join(tmpdir(), 'workspace-handle-'));
        root = path.join(base, 'root');
        outside = path.join(base, 'outside');
        await mkdir(root);
        await mkdir(outside);
        await writeFile(path.join(outside, 'private.txt'), 'private');
    });

    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    async function openFiles() {
        const context = { path: root } as WorkspaceContext;
        const handle = await new LocalWorkspaceHandleProvider().open({ context });
        return handle.files;
    }

    it('reads and writes regular files inside the workspace', async () => {
        const files = await openFiles();
        await files.writeFile('sub/a.txt', 'hello');
        expect(await files.readText('sub/a.txt')).toBe('hello');
    });

    it('refuses to read through a symlink that leaves the workspace', async () => {
        await symlink(path.join(outside, 'private.txt'), path.join(root, 'link.txt'));
        const files = await openFiles();
        await expect(files.readText('link.txt')).rejects.toThrow();
    });

    it('refuses to write through a symlink that leaves the workspace', async () => {
        await symlink(path.join(outside, 'private.txt'), path.join(root, 'link.txt'));
        const files = await openFiles();
        await expect(files.writeFile('link.txt', 'changed')).rejects.toThrow();
        expect(await readFile(path.join(outside, 'private.txt'), 'utf-8')).toBe('private');
    });

    it('refuses to create files through a symlinked directory that leaves the workspace', async () => {
        await symlink(outside, path.join(root, 'linked-dir'));
        const files = await openFiles();
        await expect(files.writeFile('linked-dir/new.txt', 'x')).rejects.toThrow();
        await expect(readFile(path.join(outside, 'new.txt'))).rejects.toThrow();
    });

    it('allows a symlink that stays inside the workspace', async () => {
        await writeFile(path.join(root, 'real.txt'), 'inside');
        await symlink(path.join(root, 'real.txt'), path.join(root, 'link.txt'));
        const files = await openFiles();
        expect(await files.readText('link.txt')).toBe('inside');
    });
});
