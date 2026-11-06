import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isSecretPath } from './redaction.js';

const exec = promisify(execFile);
const MAX_BUNDLE = 256 * 1024 * 1024;
const MAX_PATCH = 32 * 1024 * 1024;

export interface WorkingTree {
    readonly branch: string;
    readonly head_commit: string;
    readonly bundle: Buffer;
    readonly patch: Buffer | null;
    readonly cleanup: () => Promise<void>;
}

export interface LocalTreeCheckpoint {
    readonly branch: string;
    readonly head: string;
    readonly patchHash: string;
}

async function git(cwd: string, args: string[], env = process.env): Promise<Buffer> {
    return (
        await exec('git', ['-c', 'diff.submodule=short', '-c', 'color.ui=never', ...args], {
            cwd,
            env: { ...env, GIT_NO_REPLACE_OBJECTS: '1' },
            encoding: 'buffer',
            maxBuffer: MAX_BUNDLE + 1,
        })
    ).stdout;
}

export async function gitRepositoryRoot(cwd: string): Promise<string> {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).toString().replace(/\r?\n$/u, '');
}

async function refuseSecretTree(repository: string, commit: string): Promise<void> {
    const secret = (await git(repository, ['ls-tree', '-r', '--name-only', '-z', commit]))
        .toString()
        .split('\0')
        .find(isSecretPath);
    if (secret !== undefined)
        throw new Error(
            `The branch history contains a secret-shaped file: ${JSON.stringify(secret)}. Use a clean branch before moving.`
        );
}

/** Merge parents and deleted paths matter because a bundle carries reachable history. */
export async function refuseSecretHistory(repository: string, revision: string): Promise<void> {
    const secret = (
        await git(repository, [
            'log',
            '-m',
            '--no-renames',
            '--no-color',
            '--name-only',
            '--format=',
            '-z',
            revision,
            '--',
        ])
    )
        .toString()
        .split('\0')
        .find(isSecretPath);
    if (secret !== undefined)
        throw new Error(
            `The branch history contains a secret-shaped file: ${JSON.stringify(secret)}. Use a clean branch before moving.`
        );
}

/** Inspect the complete repository using a private index, without changing the user's staging. */
async function workingTreeFiles(
    cwd: string
): Promise<{ repository: string; branch: string; head_commit: string; patch: Buffer | null }> {
    const repository = await gitRepositoryRoot(cwd);
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-move-index-'));
    try {
        const branch = (await git(repository, ['symbolic-ref', '--short', 'HEAD']))
            .toString()
            .trim();
        const head_commit = (await git(repository, ['rev-parse', 'HEAD'])).toString().trim();
        // Refuse tracked secret files before diff can read their contents.
        await refuseSecretTree(repository, head_commit);
        const env = { ...process.env, GIT_INDEX_FILE: path.join(folder, 'index') };
        await git(repository, ['read-tree', head_commit], env);
        const candidates = (
            await git(repository, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        )
            .toString()
            .split('\0')
            .filter(Boolean);
        const safe = candidates.filter((name) => !isSecretPath(name));
        const pathspec = path.join(folder, 'paths');
        await writeFile(pathspec, safe.join('\0') + '\0');
        if (safe.length > 0)
            await git(
                repository,
                [
                    '--literal-pathspecs',
                    'add',
                    '-N',
                    '--pathspec-from-file=' + pathspec,
                    '--pathspec-file-nul',
                ],
                env
            );
        const patch = await git(
            repository,
            [
                '--literal-pathspecs',
                'diff',
                '--submodule=short',
                '--no-color',
                '--no-renames',
                '--binary',
                '--no-ext-diff',
                '--no-textconv',
                '--src-prefix=a/',
                '--dst-prefix=b/',
                head_commit,
                '--',
            ],
            env
        );
        if (patch.length > MAX_PATCH) throw new Error('The working-tree patch exceeds 32 MiB.');
        return { repository, branch, head_commit, patch: patch.length === 0 ? null : patch };
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

/** A return checkpoint needs the local tree's identity, never a redundant full-history bundle. */
export async function readLocalTreeCheckpoint(cwd: string): Promise<LocalTreeCheckpoint> {
    const tree = await workingTreeFiles(cwd);
    return {
        branch: tree.branch,
        head: tree.head_commit,
        patchHash: createHash('sha256')
            .update(tree.patch ?? Buffer.alloc(0))
            .digest('hex'),
    };
}

/** Build a pinned branch bundle plus the non-ignored, non-secret working-tree patch. */
export async function buildWorkingTree(cwd: string): Promise<WorkingTree> {
    const tree = await workingTreeFiles(cwd);
    const { repository, branch, head_commit, patch } = tree;
    // A full bundle carries deleted history too, so every reachable tree is checked.
    await refuseSecretHistory(repository, head_commit);
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-move-bundle-'));
    const cleanup = () => rm(folder, { recursive: true, force: true });
    try {
        const bundlePath = path.join(folder, 'tree.bundle');
        const bare = path.join(folder, 'repository.git');
        await git(repository, ['init', '--bare', bare]);
        await git(repository, ['--git-dir=' + bare, 'fetch', '--no-tags', repository, head_commit]);
        await git(repository, [
            '--git-dir=' + bare,
            'update-ref',
            `refs/heads/${branch}`,
            head_commit,
        ]);
        await git(repository, [
            '--git-dir=' + bare,
            'symbolic-ref',
            'HEAD',
            `refs/heads/${branch}`,
        ]);
        await git(repository, [
            '--git-dir=' + bare,
            'bundle',
            'create',
            bundlePath,
            'HEAD',
            branch,
        ]);
        if ((await stat(bundlePath)).size > MAX_BUNDLE)
            throw new Error('The branch bundle exceeds 256 MiB.');
        return { branch, head_commit, patch, bundle: await readFile(bundlePath), cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
