import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildWorkingTree } from './working-tree.js';
import { describeObject } from './move.js';
import { isSecretPath } from './redaction.js';

export interface LocalTreeCheckpoint {
    readonly branch: string;
    readonly head: string;
    readonly patchHash: string;
}
export interface ReturnedTree {
    readonly branch: string;
    readonly head: string;
    readonly bundle: Buffer | null;
    readonly patch: Buffer | null;
}

/** Validate in a separate checkout before touching the person's branch, keeping a stash backup. */
export async function applyReturnedTree(
    cwd: string,
    baseline: LocalTreeCheckpoint,
    returned: ReturnedTree
): Promise<void> {
    const current = await buildWorkingTree(cwd);
    try {
        if (
            current.branch !== baseline.branch ||
            current.head_commit !== baseline.head ||
            describeObject(current.patch ?? Buffer.alloc(0)).sha256 !== baseline.patchHash
        )
            throw new Error(
                'This working tree changed since hand-off. Save those changes before bringing the chat back.'
            );
    } finally {
        await current.cleanup();
    }
    if (returned.branch !== baseline.branch)
        throw new Error('The cloud changed branch. Bring its work back into a separate checkout.');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(returned.head))
        throw new Error('Invalid cloud head commit.');
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-return-'));
    const checkout = path.join(folder, 'checkout');
    const git = async (args: string[], directory = cwd): Promise<string> =>
        (await promisify(execFile)('git', args, { cwd: directory, maxBuffer: 64 * 1024 * 1024 }))
            .stdout;
    let added = false;
    try {
        if (returned.bundle !== null) {
            const bundle = path.join(folder, 'return.bundle');
            await writeFile(bundle, returned.bundle, { mode: 0o600 });
            await git(['bundle', 'verify', bundle]);
            await git(['fetch', '--no-tags', bundle, returned.head]);
        }
        await git(['merge-base', '--is-ancestor', baseline.head, returned.head]);
        const commits = (await git(['rev-list', returned.head])).trim().split('\n');
        for (const commit of commits) {
            const secret = (await git(['ls-tree', '-r', '--name-only', '-z', commit]))
                .split('\0')
                .find(isSecretPath);
            if (secret !== undefined)
                throw new Error(
                    `Cloud history contains a secret-shaped file: ${JSON.stringify(secret)}.`
                );
        }
        await git(['worktree', 'add', '--detach', checkout, returned.head]);
        added = true;
        const patchPath = path.join(folder, 'return.patch');
        if (returned.patch !== null) {
            await writeFile(patchPath, returned.patch, { mode: 0o600 });
            const numstat = await git(['apply', '--numstat', '-z', patchPath], checkout);
            for (const row of numstat.split('\0').filter(Boolean)) {
                const name = row.split('\t').slice(2).join('\t');
                if (name === '' || isSecretPath(name))
                    throw new Error(
                        `Cloud patch contains a refused path: ${JSON.stringify(name)}.`
                    );
            }
            await git(['apply', '--check', patchPath], checkout);
            await git(['apply', patchPath], checkout);
        }
        const dirty = (await git(['status', '--porcelain'])).length > 0;
        if (dirty) {
            const safe = (
                await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
            )
                .split('\0')
                .filter((name) => name.length > 0 && !isSecretPath(name));
            if (safe.length > 0)
                await git([
                    '--literal-pathspecs',
                    'stash',
                    'push',
                    '--include-untracked',
                    '-m',
                    'dexto hand-off backup',
                    '--',
                    ...safe,
                ]);
        }
        try {
            await git(['checkout', '--no-overwrite-ignore', '-B', baseline.branch, returned.head]);
            if (returned.patch !== null) await git(['apply', patchPath]);
        } catch (error) {
            // The staged checkout already proved the patch. Failures here are local collisions;
            // leave the backup intact and name the recovery rather than dropping anyone's work.
            throw new Error(
                'Could not apply the cloud tree. Your local changes remain in the dexto hand-off backup stash.',
                { cause: error }
            );
        }
    } finally {
        if (added) await git(['worktree', 'remove', '--force', checkout]);
        await rm(folder, { recursive: true, force: true });
    }
}
