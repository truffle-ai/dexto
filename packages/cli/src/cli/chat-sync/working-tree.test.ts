import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { buildWorkingTree } from './working-tree.js';
import { applyReturnedTree } from './return-tree.js';
import { describeObject } from './move.js';

const run = promisify(execFile);
const folders: string[] = [];
afterEach(async () => {
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

async function repository(): Promise<string> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'chat-move-'));
    folders.push(cwd);
    await run('git', ['init', '-b', 'main'], { cwd });
    await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd });
    await run('git', ['config', 'user.name', 'Test'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'before\n');
    await run('git', ['add', 'code.txt'], { cwd });
    await run('git', ['commit', '-m', 'initial'], { cwd });
    return cwd;
}

it('bundles the branch and patches untracked changes without secrets, ignored files or changing the real index', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, '.gitignore'), 'ignored.txt\n');
    for (const file of ['.env.fake', 'credentials.fake', 'ignored.txt', 'new.txt'])
        await writeFile(path.join(cwd, file), 'fake content\n');
    await writeFile(path.join(cwd, 'code.txt'), 'after\n');
    const before = await readFile(path.join(cwd, '.git/index'));
    const tree = await buildWorkingTree(cwd);
    try {
        expect(tree.branch).toBe('main');
        expect(tree.patch?.toString()).toContain('diff --git a/new.txt b/new.txt');
        expect(tree.patch?.toString()).toContain('+after');
        expect(tree.patch?.toString()).not.toMatch(
            /diff --git a\/(?:\.env.fake|credentials.fake|ignored.txt)/
        );
        expect(await readFile(path.join(cwd, '.git/index'))).toEqual(before);
    } finally {
        await tree.cleanup();
    }
});

it('refuses a secret-shaped file in history even after it was deleted', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, '.env.fake'), 'fake only\n');
    await run('git', ['add', '.env.fake'], { cwd });
    await run('git', ['commit', '-m', 'fake secret name'], { cwd });
    await run('git', ['rm', '.env.fake'], { cwd });
    await run('git', ['commit', '-m', 'remove fake file'], { cwd });
    await expect(buildWorkingTree(cwd)).rejects.toThrow('secret-shaped');
});

it('applies a returned patch and preserves a local backup of the handed-off changes', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, 'code.txt'), 'local dirty\n');
    await writeFile(path.join(cwd, '.env.fake'), 'fake local-only content\n');
    const tree = await buildWorkingTree(cwd);
    try {
        await applyReturnedTree(
            cwd,
            {
                branch: tree.branch,
                head: tree.head_commit,
                patchHash: describeObject(tree.patch ?? Buffer.alloc(0)).sha256,
            },
            {
                branch: tree.branch,
                head: tree.head_commit,
                bundle: null,
                patch: Buffer.from(
                    'diff --git a/code.txt b/code.txt\n--- a/code.txt\n+++ b/code.txt\n@@ -1 +1 @@\n-before\n+cloud edit\n'
                ),
            }
        );
        expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('cloud edit\n');
        expect(await readFile(path.join(cwd, '.env.fake'), 'utf8')).toBe(
            'fake local-only content\n'
        );
        expect((await run('git', ['stash', 'list'], { cwd })).stdout).toContain(
            'dexto hand-off backup'
        );
    } finally {
        await tree.cleanup();
    }
});

it('refuses local drift before changing the branch or files', async () => {
    const cwd = await repository();
    const tree = await buildWorkingTree(cwd);
    try {
        await writeFile(path.join(cwd, 'code.txt'), 'new local work\n');
        await expect(
            applyReturnedTree(
                cwd,
                {
                    branch: tree.branch,
                    head: tree.head_commit,
                    patchHash: describeObject(Buffer.alloc(0)).sha256,
                },
                { branch: tree.branch, head: tree.head_commit, bundle: null, patch: null }
            )
        ).rejects.toThrow('changed since hand-off');
        expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('new local work\n');
    } finally {
        await tree.cleanup();
    }
});

it('refuses a secret-shaped returned patch before changing the local checkout', async () => {
    const cwd = await repository();
    const tree = await buildWorkingTree(cwd);
    try {
        await expect(
            applyReturnedTree(
                cwd,
                {
                    branch: tree.branch,
                    head: tree.head_commit,
                    patchHash: describeObject(Buffer.alloc(0)).sha256,
                },
                {
                    branch: tree.branch,
                    head: tree.head_commit,
                    bundle: null,
                    patch: Buffer.from(
                        'diff --git a/.env.fake b/.env.fake\nnew file mode 100644\n--- /dev/null\n+++ b/.env.fake\n@@ -0,0 +1 @@\n+fake content\n'
                    ),
                }
            )
        ).rejects.toThrow('refused path');
        expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('before\n');
    } finally {
        await tree.cleanup();
    }
});

it('fetches and fast-forwards returned commits from the incremental cloud bundle', async () => {
    const cwd = await repository();
    const tree = await buildWorkingTree(cwd);
    const cloud = await repository();
    try {
        await run('git', ['fetch', cwd, tree.head_commit], { cwd: cloud });
        await run('git', ['reset', '--hard', tree.head_commit], { cwd: cloud });
        await writeFile(path.join(cloud, 'code.txt'), 'cloud commit\n');
        await run('git', ['add', 'code.txt'], { cwd: cloud });
        await run('git', ['commit', '-m', 'cloud work'], { cwd: cloud });
        const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: cloud })).stdout.trim();
        const bundlePath = path.join(cloud, 'return.bundle');
        await run('git', ['bundle', 'create', bundlePath, 'HEAD', `^${tree.head_commit}`], {
            cwd: cloud,
        });
        await applyReturnedTree(
            cwd,
            {
                branch: tree.branch,
                head: tree.head_commit,
                patchHash: describeObject(Buffer.alloc(0)).sha256,
            },
            { branch: tree.branch, head, bundle: await readFile(bundlePath), patch: null }
        );
        expect((await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim()).toBe(head);
        expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('cloud commit\n');
    } finally {
        await tree.cleanup();
    }
});
