import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
    gitRepositoryRoot,
    readLocalTreeCheckpoint,
    refuseSecretHistory,
    type LocalTreeCheckpoint,
} from './working-tree.js';
import { isSecretPath } from './redaction.js';
import { CommandFailure } from '../failure.js';

const TreeCheckpoint = z
    .object({ branch: z.string(), head: z.string(), patchHash: z.string() })
    .strict();
export const ReturnCheckpointSchema = z.discriminatedUnion('phase', [
    TreeCheckpoint.extend({ phase: z.literal('cloud') }).strict(),
    TreeCheckpoint.extend({ phase: z.literal('returning'), moveId: z.string() }).strict(),
    TreeCheckpoint.extend({
        phase: z.literal('applied'),
        moveId: z.string(),
        appliedTree: TreeCheckpoint,
    }).strict(),
    TreeCheckpoint.extend({
        phase: z.literal('resumed'),
        moveId: z.string(),
        appliedTree: TreeCheckpoint,
        nextIndex: z.number().int().nonnegative(),
        sentCount: z.number().int().nonnegative(),
    }).strict(),
]);

export async function assertLocalTreeMatches(
    cwd: string,
    expected: LocalTreeCheckpoint
): Promise<void> {
    const current = await readLocalTreeCheckpoint(cwd);
    if (
        current.branch !== expected.branch ||
        current.head !== expected.head ||
        current.patchHash !== expected.patchHash
    )
        throw new CommandFailure(
            'invalid_input',
            'This working tree changed since hand-off. Save those changes before bringing the chat back.',
            'git status'
        );
}

/** An abandoned server return is retried from the last tree we actually applied, preserving edits. */
export async function recoverAbandonedReturn(
    cwd: string,
    checkpoint: z.output<typeof ReturnCheckpointSchema>
): Promise<Extract<z.output<typeof ReturnCheckpointSchema>, { phase: 'cloud' }>> {
    if (checkpoint.phase === 'applied' || checkpoint.phase === 'resumed') {
        await assertLocalTreeMatches(cwd, checkpoint.appliedTree);
        return { ...checkpoint.appliedTree, phase: 'cloud' };
    }
    return {
        branch: checkpoint.branch,
        head: checkpoint.head,
        patchHash: checkpoint.patchHash,
        phase: 'cloud',
    };
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
    await assertLocalTreeMatches(cwd, baseline);
    const repository = await gitRepositoryRoot(cwd);
    if (returned.branch !== baseline.branch)
        throw new Error('The cloud changed branch. Bring its work back into a separate checkout.');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(returned.head))
        throw new Error('Invalid cloud head commit.');
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-return-'));
    const checkout = path.join(folder, 'checkout');
    const git = (args: string[], directory = repository): Promise<string> =>
        new Promise((resolve, reject) => {
            // Git owns another process group so a terminal SIGINT cannot interrupt rollback.
            const child = spawn(
                'git',
                [
                    '-c',
                    'core.hooksPath=/dev/null',
                    '-c',
                    'diff.submodule=short',
                    '-c',
                    'color.ui=never',
                    ...args,
                ],
                {
                    cwd: directory,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'ignore'],
                    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_LFS_SKIP_SMUDGE: '1' },
                }
            );
            let output = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => {
                output += chunk;
                if (output.length > 64 * 1024 * 1024) {
                    child.kill();
                    reject(new Error('Git output exceeded the return size limit.'));
                }
            });
            child.once('error', reject);
            child.once('close', (code) =>
                code === 0 ? resolve(output) : reject(new Error(`Git ${args[0]} failed (${code}).`))
            );
        });
    let added = false;
    try {
        if (returned.bundle !== null) {
            const bundle = path.join(folder, 'return.bundle');
            await writeFile(bundle, returned.bundle, { mode: 0o600 });
            await git(['bundle', 'verify', bundle]);
            await git(['fetch', '--no-tags', bundle, returned.head]);
        }
        await git(['merge-base', '--is-ancestor', baseline.head, returned.head]).catch(() => {
            throw new CommandFailure(
                'invalid_input',
                'The cloud history was rewritten. Recover its work into a separate checkout before returning this chat.',
                'git log --oneline --all'
            );
        });
        await refuseSecretHistory(repository, `${baseline.head}..${returned.head}`);
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
        const backupMessage = `dexto hand-off backup ${randomUUID()}`;
        let checkoutAttempted = false;
        try {
            const dirty = (await git(['status', '--porcelain'])).length > 0;
            if (dirty) {
                const candidates = (
                    await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
                )
                    .split('\0')
                    .filter(Boolean);
                if (candidates.length > 0) {
                    // Keep the positive pathspec compact too: Git's stash implementation
                    // forwards it to child commands, even with --pathspec-from-file.
                    const pathsToStash = [
                        '.',
                        ...candidates
                            .filter(isSecretPath)
                            .map((name) => `:(exclude,literal)${name}`),
                    ];
                    const paths = path.join(folder, 'stash-paths');
                    await writeFile(paths, pathsToStash.join('\0') + '\0', { mode: 0o600 });
                    await git([
                        'stash',
                        'push',
                        '--include-untracked',
                        '-m',
                        backupMessage,
                        '--pathspec-from-file=' + paths,
                        '--pathspec-file-nul',
                    ]);
                }
            }
            checkoutAttempted = true;
            await git(['checkout', '--no-overwrite-ignore', '-B', baseline.branch, returned.head]);
            if (returned.patch !== null) await git(['apply', patchPath]);
        } catch {
            try {
                const backup = (await git(['stash', 'list', '--format=%gd\t%gs']))
                    .split('\n')
                    .find((entry) => entry.endsWith(backupMessage))
                    ?.split('\t')[0];
                if (checkoutAttempted || backup !== undefined)
                    await git(['reset', '--hard', baseline.head]);
                if (backup !== undefined) await git(['stash', 'pop', '--index', backup]);
            } catch {
                throw new CommandFailure(
                    'failed',
                    `Cloud work could not be applied or fully restored. Recover your backup named ${backupMessage}.`,
                    'git stash list'
                );
            }
            throw new CommandFailure(
                'invalid_input',
                'Cloud work could not be applied. Your local branch, index and files were restored. Resolve local file collisions and retry.',
                'git status --ignored'
            );
        }
    } finally {
        if (added) await git(['worktree', 'remove', '--force', checkout]);
        await rm(folder, { recursive: true, force: true });
    }
}
