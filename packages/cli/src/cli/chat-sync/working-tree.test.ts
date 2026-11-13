import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { buildWorkingTree, readLocalTreeCheckpoint } from './working-tree.js';
import { applyReturnedTree, recoverAbandonedReturn } from './return-tree.js';
import { describeObject } from './move.js';
import { packLfsEnvelope, unpackLfsEnvelope } from './lfs-envelope.js';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const folders: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
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

it('includes the current committed LFS object in the handoff', async () => {
    const cwd = await repository();
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd });
    await run('git', ['lfs', 'track', '*.bin'], { cwd });
    await writeFile(path.join(cwd, 'asset.bin'), 'large object content\n');
    await run('git', ['add', '.gitattributes', 'asset.bin'], { cwd });
    await run('git', ['commit', '-m', 'LFS object'], { cwd });
    const tree = await buildWorkingTree(cwd);
    try {
        const envelope = unpackLfsEnvelope(tree.bundle);
        expect(envelope.objects.map((object) => object.content.toString())).toEqual([
            'large object content\n',
        ]);
    } finally {
        await tree.cleanup();
    }
});

it('includes an uncommitted LFS object in the handoff', async () => {
    const cwd = await repository();
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd });
    await run('git', ['lfs', 'track', '*.bin'], { cwd });
    await run('git', ['add', '.gitattributes'], { cwd });
    await run('git', ['commit', '-m', 'LFS attributes'], { cwd });
    await writeFile(path.join(cwd, 'asset.bin'), 'uncommitted object\n');
    const tree = await buildWorkingTree(cwd);
    try {
        expect(
            unpackLfsEnvelope(tree.bundle).objects.map((object) => object.content.toString())
        ).toEqual(['uncommitted object\n']);
    } finally {
        await tree.cleanup();
    }
});

it.each([12, 256 * 1024 * 1024 + 1])(
    'names a missing or oversized LFS file before upload',
    async (size) => {
        const cwd = await repository();
        await writeFile(
            path.join(cwd, 'missing.bin'),
            `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`
        );
        await run('git', ['add', 'missing.bin'], { cwd });
        await run('git', ['commit', '-m', 'missing pointer'], { cwd });
        await expect(buildWorkingTree(cwd)).rejects.toThrow(`"missing.bin" (${size} bytes)`);
        expect(await readFile(path.join(cwd, 'missing.bin'), 'utf8')).toContain(`size ${size}`);
    }
);

/** A local LFS repository and a cloud clone that committed cloud.bin, for return tests. */
async function cloudLfsReturn() {
    const cwd = await repository();
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd });
    await run('git', ['lfs', 'track', '*.bin'], { cwd });
    const original = Buffer.from('original local file\n');
    await writeFile(path.join(cwd, 'original.bin'), original);
    await run('git', ['add', '.gitattributes', 'original.bin'], { cwd });
    await run('git', ['commit', '-m', 'initial LFS object'], { cwd });
    const baseline = await readLocalTreeCheckpoint(cwd);
    const cloud = await mkdtemp(path.join(tmpdir(), 'chat-move-cloud-'));
    folders.push(cloud);
    await run('git', ['clone', '--no-local', cwd, cloud], {
        env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
    await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: cloud });
    await run('git', ['config', 'user.name', 'Test'], { cwd: cloud });
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd: cloud });
    await writeFile(path.join(cloud, 'original.bin'), original);
    await writeFile(path.join(cloud, 'cloud.bin'), Buffer.from('committed in cloud\n'));
    await run('git', ['add', 'original.bin', 'cloud.bin'], { cwd: cloud });
    await run('git', ['commit', '-m', 'cloud LFS object'], { cwd: cloud });
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: cloud })).stdout.trim();
    const bundlePath = path.join(cloud, 'return.bundle');
    await run('git', ['bundle', 'create', bundlePath, 'HEAD'], { cwd: cloud });
    const object = (content: Buffer) => ({
        oid: createHash('sha256').update(content).digest('hex'),
        content,
    });
    return { cwd, cloud, baseline, head, bundlePath, original, object };
}

/** The cloud's uncommitted changes as the exporter sends them: `git diff --binary HEAD`. */
async function cloudPatch(cloud: string): Promise<Buffer> {
    const { stdout } = await run('git', ['diff', '--binary', 'HEAD'], {
        cwd: cloud,
        encoding: 'buffer',
    });
    return stdout;
}

it('returns a cloud-uncommitted LFS deletion without the deleted object', async () => {
    const { cwd, cloud, baseline, head, bundlePath, original, object } = await cloudLfsReturn();
    await rm(path.join(cloud, 'cloud.bin'));
    // The exporter carries only the objects of the final, patched tree.
    const bundle = packLfsEnvelope(await readFile(bundlePath), [object(original)]);
    await applyReturnedTree(cwd, baseline, {
        branch: baseline.branch,
        head,
        bundle,
        patch: await cloudPatch(cloud),
    });
    await expect(readFile(path.join(cwd, 'cloud.bin'))).rejects.toThrow();
    expect(await readFile(path.join(cwd, 'original.bin'))).toEqual(original);
});

it('returns a raw bundle when the cloud deleted every LFS file without committing', async () => {
    const { cwd, cloud, baseline, head, bundlePath } = await cloudLfsReturn();
    await rm(path.join(cloud, 'cloud.bin'));
    await rm(path.join(cloud, 'original.bin'));
    // No LFS objects remain in the patched tree, so the exporter sends the plain bundle.
    await applyReturnedTree(cwd, baseline, {
        branch: baseline.branch,
        head,
        bundle: await readFile(bundlePath),
        patch: await cloudPatch(cloud),
    });
    await expect(readFile(path.join(cwd, 'cloud.bin'))).rejects.toThrow();
    await expect(readFile(path.join(cwd, 'original.bin'))).rejects.toThrow();
});

it('returns a cloud-uncommitted LFS replacement without the replaced object', async () => {
    const { cwd, cloud, baseline, head, bundlePath, original, object } = await cloudLfsReturn();
    const replaced = Buffer.from('replaced in cloud, not committed\n');
    await writeFile(path.join(cloud, 'cloud.bin'), replaced);
    const bundle = packLfsEnvelope(await readFile(bundlePath), [
        object(original),
        object(replaced),
    ]);
    await applyReturnedTree(cwd, baseline, {
        branch: baseline.branch,
        head,
        bundle,
        patch: await cloudPatch(cloud),
    });
    expect(await readFile(path.join(cwd, 'cloud.bin'))).toEqual(replaced);
    expect(await readFile(path.join(cwd, 'original.bin'))).toEqual(original);
});

it('returns a cloud-created LFS object into a separate local store', async () => {
    const cwd = await repository();
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd });
    await run('git', ['lfs', 'track', '*.bin'], { cwd });
    const initialContent = Buffer.from('original local file\n');
    await writeFile(path.join(cwd, 'original.bin'), initialContent);
    await run('git', ['add', '.gitattributes', 'original.bin'], { cwd });
    await run('git', ['commit', '-m', 'initial LFS object'], { cwd });
    const localOnly = Buffer.from('local-only retained object\n');
    const localOnlyOid = createHash('sha256').update(localOnly).digest('hex');
    await writeFile(path.join(cwd, 'original.bin'), localOnly);
    await run('git', ['add', 'original.bin'], { cwd });
    await run('git', ['reset', 'HEAD', '--', 'original.bin'], { cwd });
    await run('git', ['checkout', '--', 'original.bin'], { cwd });
    const baseline = await readLocalTreeCheckpoint(cwd);
    const cloud = await mkdtemp(path.join(tmpdir(), 'chat-move-cloud-'));
    folders.push(cloud);
    await run('git', ['clone', '--no-local', cwd, cloud], {
        env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
    await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: cloud });
    await run('git', ['config', 'user.name', 'Test'], { cwd: cloud });
    await run('git', ['lfs', 'install', '--local', '--skip-repo'], { cwd: cloud });
    await writeFile(path.join(cloud, 'original.bin'), initialContent);
    await run('git', ['add', 'original.bin'], { cwd: cloud });
    const content = Buffer.from('created in cloud\n');
    await writeFile(path.join(cloud, 'cloud.bin'), content);
    await run('git', ['add', '.gitattributes', 'cloud.bin'], { cwd: cloud });
    await run('git', ['commit', '-m', 'cloud LFS object'], { cwd: cloud });
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: cloud })).stdout.trim();
    const bundlePath = path.join(cloud, 'return.bundle');
    await run('git', ['bundle', 'create', bundlePath, 'HEAD'], { cwd: cloud });
    const oid = createHash('sha256').update(content).digest('hex');
    const originalOid = createHash('sha256').update(initialContent).digest('hex');
    const incomplete = packLfsEnvelope(await readFile(bundlePath), [
        { oid: originalOid, content: initialContent },
    ]);
    await expect(
        applyReturnedTree(cwd, baseline, {
            branch: baseline.branch,
            head,
            bundle: incomplete,
            patch: null,
        })
    ).rejects.toThrow('cloud.bin');
    expect(await readFile(path.join(cwd, 'original.bin'))).toEqual(initialContent);
    expect(
        await readFile(
            path.join(
                cwd,
                '.git',
                'lfs',
                'objects',
                localOnlyOid.slice(0, 2),
                localOnlyOid.slice(2, 4),
                localOnlyOid
            )
        )
    ).toEqual(localOnly);
    const bundle = packLfsEnvelope(await readFile(bundlePath), [
        { oid, content },
        { oid: originalOid, content: initialContent },
    ]);
    await applyReturnedTree(cwd, baseline, { branch: baseline.branch, head, bundle, patch: null });
    expect(await readFile(path.join(cwd, 'cloud.bin'))).toEqual(content);
    expect(await readFile(path.join(cwd, 'original.bin'))).toEqual(initialContent);
    expect(
        await readFile(
            path.join(
                cwd,
                '.git',
                'lfs',
                'objects',
                localOnlyOid.slice(0, 2),
                localOnlyOid.slice(2, 4),
                localOnlyOid
            )
        )
    ).toEqual(localOnly);
});

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
        expect(tree.repository).toBe(await realpath(cwd));
        // new.txt, .gitignore and code.txt; secrets and ignored files are not counted.
        expect(tree.changedFiles).toBe(3);
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

it.each([
    { name: 'is the home directory', home: '' },
    { name: 'is an ancestor of the home directory', home: 'users/someone' },
])('refuses a repository that $name', async ({ home }) => {
    const cwd = await repository();
    await mkdir(path.join(cwd, home), { recursive: true });
    vi.stubEnv('HOME', path.join(cwd, home));
    vi.stubEnv('USERPROFILE', path.join(cwd, home));
    await writeFile(path.join(cwd, 'notes.txt'), 'would be uploaded\n');
    await expect(buildWorkingTree(path.join(cwd, home))).rejects.toMatchObject({
        kind: 'invalid_input',
        message: expect.stringContaining('move a project folder, not your home directory'),
    });
});

it('moves a project repository inside the home directory', async () => {
    const cwd = await repository();
    vi.stubEnv('HOME', path.dirname(cwd));
    vi.stubEnv('USERPROFILE', path.dirname(cwd));
    const tree = await buildWorkingTree(cwd);
    await tree.cleanup();
    expect(tree.branch).toBe('main');
    expect(tree.changedFiles).toBe(0);
});

it('explains when the working folder is not in a Git repository', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'chat-move-plain-'));
    folders.push(cwd);
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(cwd));
    await expect(buildWorkingTree(cwd)).rejects.toMatchObject({
        kind: 'invalid_input',
        message: `${cwd} is not inside a Git repository. Chat move hands off a Git project, so open the chat in a project folder that uses Git.`,
    });
});

it('refuses a missing working folder before running Git', async () => {
    const cwd = path.join(tmpdir(), `chat-move-missing-${process.pid}-${Date.now()}`);
    await expect(buildWorkingTree(cwd)).rejects.toMatchObject({
        kind: 'invalid_input',
        message: `The chat's working folder ${cwd} no longer exists.`,
    });
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

it('isolates patches from inline submodule diffs, colors and rename configuration', async () => {
    const cwd = await repository();
    const sub = await repository();
    await writeFile(path.join(sub, '.env.fake'), 'fake original\n');
    await run('git', ['add', '.env.fake'], { cwd: sub });
    await run('git', ['commit', '-m', 'fake submodule fixture'], { cwd: sub });
    await run('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', sub, 'sub'], { cwd });
    await run('git', ['commit', '-am', 'submodule'], { cwd });
    await run('git', ['config', 'diff.submodule', 'diff'], { cwd });
    await run('git', ['config', 'color.ui', 'always'], { cwd });
    await run('git', ['config', 'diff.renames', 'copies'], { cwd });
    await writeFile(path.join(cwd, 'sub', '.env.fake'), 'fake submodule secret sentinel\n');
    await writeFile(path.join(cwd, 'code.txt'), 'safe changed code\n');
    const tree = await buildWorkingTree(cwd);
    try {
        expect(tree.patch?.toString()).toContain('+safe changed code');
        expect(tree.patch?.toString()).not.toContain('fake submodule secret sentinel');
        expect(tree.patch?.toString()).not.toContain('\u001b');
    } finally {
        await tree.cleanup();
    }
});

it('moves the whole repository when the chat started in a nested folder', async () => {
    const cwd = await repository();
    const nested = path.join(cwd, 'packages', 'example');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(cwd, 'code.txt'), 'root change\n');
    await writeFile(path.join(nested, 'nested.txt'), 'nested change\n');
    const tree = await buildWorkingTree(nested);
    try {
        expect(tree.patch?.toString()).toContain('diff --git a/code.txt b/code.txt');
        expect(tree.patch?.toString()).toContain(
            'diff --git a/packages/example/nested.txt b/packages/example/nested.txt'
        );
    } finally {
        await tree.cleanup();
    }
});

it('applies files outside the saved chat subfolder when returning', async () => {
    const cwd = await repository();
    const nested = path.join(cwd, 'packages', 'example');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, '.keep'), 'fake fixture\n');
    await run('git', ['add', 'packages/example/.keep'], { cwd });
    await run('git', ['commit', '-m', 'nested fixture'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'local dirty\n');
    const baseline = await readLocalTreeCheckpoint(nested);
    await applyReturnedTree(nested, baseline, {
        branch: baseline.branch,
        head: baseline.head,
        bundle: null,
        patch: Buffer.from(
            'diff --git a/code.txt b/code.txt\n--- a/code.txt\n+++ b/code.txt\n@@ -1 +1 @@\n-before\n+cloud root change\n'
        ),
    });
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('cloud root change\n');
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
        ).rejects.toMatchObject({ kind: 'invalid_input', fix: 'git status' });
        expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('new local work\n');
    } finally {
        await tree.cleanup();
    }
});

it('gives actionable refusals for detached HEAD and rewritten cloud history', async () => {
    const cwd = await repository();
    const baseline = await readLocalTreeCheckpoint(cwd);
    await run('git', ['checkout', '--detach'], { cwd });
    await expect(buildWorkingTree(cwd)).rejects.toMatchObject({
        kind: 'invalid_input',
        fix: 'git switch <branch>',
    });
    await run('git', ['checkout', '--orphan', 'rewritten'], { cwd });
    await run('git', ['commit', '-am', 'rewritten history'], { cwd });
    const rewritten = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    await run('git', ['checkout', 'main'], { cwd });
    await expect(
        applyReturnedTree(cwd, baseline, {
            branch: 'main',
            head: rewritten,
            bundle: null,
            patch: null,
        })
    ).rejects.toMatchObject({ kind: 'invalid_input', fix: 'git log --oneline --all' });
    expect(await readLocalTreeCheckpoint(cwd)).toEqual(baseline);
});

it('restores the branch, index and dirty files when real application fails after checkout', async () => {
    const cwd = await repository();
    const originalHead = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    await run('git', ['checkout', '-b', 'cloud-work'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'cloud commit\n');
    await run('git', ['commit', '-am', 'cloud commit'], { cwd });
    const cloudHead = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    await run('git', ['checkout', 'main'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'original staged work\n');
    await run('git', ['add', 'code.txt'], { cwd });
    const indexBefore = (await run('git', ['diff', '--cached'], { cwd })).stdout;
    const excludes = path.join(cwd, '.git', 'global-excludes');
    await writeFile(excludes, 'collision.txt\n');
    await run('git', ['config', 'core.excludesFile', excludes], { cwd });
    await writeFile(path.join(cwd, 'collision.txt'), 'ignored local file\n');
    const baseline = await readLocalTreeCheckpoint(cwd);
    const returned = {
        branch: 'main',
        head: cloudHead,
        bundle: null,
        patch: Buffer.from(
            'diff --git a/collision.txt b/collision.txt\nnew file mode 100644\n--- /dev/null\n+++ b/collision.txt\n@@ -0,0 +1 @@\n+cloud file\n'
        ),
    };

    await expect(applyReturnedTree(cwd, baseline, returned)).rejects.toThrow('restored');

    expect((await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim()).toBe(originalHead);
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('original staged work\n');
    expect((await run('git', ['diff', '--cached'], { cwd })).stdout).toBe(indexBefore);
    expect(await readFile(path.join(cwd, 'collision.txt'), 'utf8')).toBe('ignored local file\n');
    expect(await readLocalTreeCheckpoint(cwd)).toEqual(baseline);
    expect((await run('git', ['stash', 'list'], { cwd })).stdout).not.toContain(
        'dexto hand-off backup'
    );
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

it('backs up a path list larger than the process argument limit', async () => {
    const cwd = await repository();
    const directory = path.join(cwd, ...Array.from({ length: 6 }, () => 'd'.repeat(120)));
    await mkdir(directory, { recursive: true });
    for (let batch = 0; batch < 35; batch += 1)
        await Promise.all(
            Array.from({ length: 100 }, (_, index) =>
                writeFile(
                    path.join(directory, `file-${batch * 100 + index}.txt`),
                    'fake safe data\n'
                )
            )
        );
    const baseline = await readLocalTreeCheckpoint(cwd);
    await applyReturnedTree(cwd, baseline, {
        branch: baseline.branch,
        head: baseline.head,
        bundle: null,
        patch: Buffer.from(
            'diff --git a/code.txt b/code.txt\n--- a/code.txt\n+++ b/code.txt\n@@ -1 +1 @@\n-before\n+cloud edit\n'
        ),
    });
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('cloud edit\n');
    expect((await run('git', ['stash', 'list'], { cwd })).stdout).toContain(
        'dexto hand-off backup'
    );
}, 60_000);

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

it('restarts an expired applied or resumed return from the applied tree while protecting new local work', async () => {
    const cwd = await repository();
    const original = await readLocalTreeCheckpoint(cwd);
    await writeFile(path.join(cwd, 'code.txt'), 'already-applied cloud work\n');
    const appliedTree = await readLocalTreeCheckpoint(cwd);
    const recovered = await recoverAbandonedReturn(cwd, {
        ...original,
        phase: 'applied',
        moveId: 'expired-move',
        appliedTree,
    });
    expect(recovered).toEqual({ ...appliedTree, phase: 'cloud' });
    expect(
        await recoverAbandonedReturn(cwd, {
            ...original,
            phase: 'resumed',
            moveId: 'expired-move',
            appliedTree,
            nextIndex: 20,
            sentCount: 5,
        })
    ).toEqual(recovered);
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('already-applied cloud work\n');
    await writeFile(path.join(cwd, 'code.txt'), 'new local work after apply\n');
    await expect(
        recoverAbandonedReturn(cwd, {
            ...original,
            phase: 'applied',
            moveId: 'expired-move',
            appliedTree,
        })
    ).rejects.toThrow('changed');
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('new local work after apply\n');
});

it('builds a patch when a staged new file was deleted before hand-off', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, 'staged.txt'), 'temporary staged work\n');
    await run('git', ['add', 'staged.txt'], { cwd });
    const staged = await buildWorkingTree(cwd);
    try {
        expect(staged.patch?.toString()).toContain('+temporary staged work');
    } finally {
        await staged.cleanup();
    }
    await rm(path.join(cwd, 'staged.txt'));
    const before = await readFile(path.join(cwd, '.git/index'));
    const tree = await buildWorkingTree(cwd);
    try {
        expect(tree.patch).toBeNull();
        expect(await readFile(path.join(cwd, '.git/index'))).toEqual(before);
    } finally {
        await tree.cleanup();
    }
});

it('checks the root commit even when user log configuration hides it', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, '.env.fake'), 'fake root fixture\n');
    await run('git', ['add', '.env.fake'], { cwd });
    await run('git', ['commit', '--amend', '--no-edit'], { cwd });
    await run('git', ['rm', '.env.fake'], { cwd });
    await run('git', ['commit', '-m', 'remove fake root fixture'], { cwd });
    await run('git', ['config', 'log.showRoot', 'false'], { cwd });
    await run('git', ['config', 'log.diffMerges', 'off'], { cwd });
    await expect(buildWorkingTree(cwd)).rejects.toThrow('.env.fake');
});

it('recognizes an applied return after a crash before saving its journal', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, 'code.txt'), 'handed off work\n');
    const baseline = await readLocalTreeCheckpoint(cwd);
    const returned = {
        branch: baseline.branch,
        head: baseline.head,
        bundle: null,
        patch: Buffer.from(
            'diff --git a/code.txt b/code.txt\n--- a/code.txt\n+++ b/code.txt\n@@ -1 +1 @@\n-before\n+returned work\n'
        ),
    };
    await applyReturnedTree(cwd, baseline, returned);
    const applied = await readLocalTreeCheckpoint(cwd);
    const stashes = (await run('git', ['stash', 'list'], { cwd })).stdout;
    await applyReturnedTree(cwd, baseline, returned);
    expect(await readLocalTreeCheckpoint(cwd)).toEqual(applied);
    expect((await run('git', ['stash', 'list'], { cwd })).stdout).toBe(stashes);
    await writeFile(path.join(cwd, 'code.txt'), 'new work after crash\n');
    await expect(applyReturnedTree(cwd, baseline, returned)).rejects.toMatchObject({
        kind: 'invalid_input',
    });
});

it('runs real checkout smudge filters while skipping them in the validation worktree', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, '.gitattributes'), '*.txt filter=dexto-test-smudge\n');
    await run(
        'git',
        [
            'config',
            'filter.dexto-test-smudge.smudge',
            'if [ "$GIT_LFS_SKIP_SMUDGE" = 1 ]; then cat; else sed s/pointer/materialized/g; fi',
        ],
        { cwd }
    );
    await run('git', ['config', 'filter.dexto-test-smudge.clean', 'sed s/materialized/pointer/g'], {
        cwd,
    });
    await run('git', ['add', '.gitattributes'], { cwd });
    await run('git', ['commit', '-m', 'fake smudge filter'], { cwd });
    const baseline = await readLocalTreeCheckpoint(cwd);
    await run('git', ['checkout', '-b', 'cloud-work'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'pointer\n');
    await run('git', ['commit', '-am', 'cloud content'], { cwd });
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    await run('git', ['checkout', 'main'], { cwd });
    await applyReturnedTree(cwd, baseline, { branch: 'main', head, bundle: null, patch: null });
    expect(await readFile(path.join(cwd, 'code.txt'), 'utf8')).toBe('materialized\n');
});

it('includes force-staged ignored additions without bundling staged secret-shaped paths', async () => {
    const cwd = await repository();
    await writeFile(path.join(cwd, '.gitignore'), 'dist/\n');
    await mkdir(path.join(cwd, 'dist'));
    await writeFile(path.join(cwd, 'dist/x'), 'forced addition\n');
    await writeFile(path.join(cwd, 'dist/.env.fake'), 'fake excluded fixture\n');
    await run('git', ['add', '-f', 'dist/x', 'dist/.env.fake'], { cwd });
    const before = await readFile(path.join(cwd, '.git/index'));
    const tree = await buildWorkingTree(cwd);
    try {
        expect(tree.patch?.toString()).toContain('diff --git a/dist/x b/dist/x');
        expect(tree.patch?.toString()).not.toContain('fake excluded fixture');
        expect(await readFile(path.join(cwd, '.git/index'))).toEqual(before);
    } finally {
        await tree.cleanup();
    }
});

it('bundles only the checked-out branch, leaving side branches and stashes unreachable', async () => {
    const cwd = await repository();
    await run('git', ['switch', '-c', 'side'], { cwd });
    await writeFile(path.join(cwd, 'side.txt'), 'side branch only\n');
    await run('git', ['add', 'side.txt'], { cwd });
    await run('git', ['commit', '-m', 'side commit'], { cwd });
    const side = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    await run('git', ['switch', 'main'], { cwd });
    await writeFile(path.join(cwd, 'code.txt'), 'stashed change\n');
    await run('git', ['stash', 'push', '-m', 'local stash'], { cwd });
    const stash = (await run('git', ['rev-parse', 'refs/stash'], { cwd })).stdout.trim();
    const tree = await buildWorkingTree(cwd);
    try {
        const verify = await mkdtemp(path.join(tmpdir(), 'chat-move-bundle-'));
        folders.push(verify);
        const bundlePath = path.join(verify, 'tree.bundle');
        await writeFile(bundlePath, tree.bundle);
        const heads = (
            await run('git', ['bundle', 'list-heads', bundlePath], { cwd: verify })
        ).stdout
            .trim()
            .split('\n');
        expect(heads.sort()).toEqual(
            [`${tree.head_commit} HEAD`, `${tree.head_commit} refs/heads/main`].sort()
        );
        // A fresh repository holds exactly the bundle's objects, so it shows what was sent.
        const unbundled = path.join(verify, 'unbundled.git');
        await run('git', ['init', '--bare', unbundled]);
        await run('git', ['--git-dir=' + unbundled, 'fetch', bundlePath, '+refs/*:refs/*']);
        await run('git', ['--git-dir=' + unbundled, 'cat-file', '-e', tree.head_commit]);
        for (const unreachable of [side, stash])
            await expect(
                run('git', ['--git-dir=' + unbundled, 'cat-file', '-e', unreachable])
            ).rejects.toThrow();
    } finally {
        await tree.cleanup();
    }
});
