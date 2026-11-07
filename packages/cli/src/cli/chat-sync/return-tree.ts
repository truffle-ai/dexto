import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
    gitRepositoryRoot,
    listTreeLfsPointers,
    readBoundedObject,
    readLocalTreeCheckpoint,
    refuseSecretHistory,
    verifyLfsObjects,
    type LocalTreeCheckpoint,
} from './working-tree.js';
import { isSecretPath } from './redaction.js';
import { handOffGit, handOffDiffOptions } from './git.js';
import { CommandFailure } from '../failure.js';
import { installLfsObjects, isLfsEnvelope, unpackLfsEnvelope } from './lfs-envelope.js';

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
    const repository = await gitRepositoryRoot(cwd);
    if (returned.branch !== baseline.branch)
        throw new Error('The cloud changed branch. Bring its work back into a separate checkout.');
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(returned.head))
        throw new Error('Invalid cloud head commit.');
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-return-'));
    const checkout = path.join(folder, 'checkout');
    const git = async (args: string[], directory = repository): Promise<string> =>
        (await handOffGit(directory, args)).toString();
    let added = false;
    let carriedLfs: Map<string, Buffer> | null = null;
    const verifyLfsTree = async (tree: string) => {
        const pointers = await listTreeLfsPointers(repository, tree);
        for (const file of pointers) {
            if (carriedLfs?.get(file.oid)?.length !== file.size)
                throw new Error(
                    `The cloud handoff is missing LFS file ${JSON.stringify(file.name)} (${file.size} bytes).`
                );
        }
        return pointers;
    };
    try {
        let returnedBundle = returned.bundle;
        if (returnedBundle !== null && isLfsEnvelope(returnedBundle)) {
            const envelope = unpackLfsEnvelope(returnedBundle);
            carriedLfs = new Map(envelope.objects.map((object) => [object.oid, object.content]));
            await verifyLfsObjects(repository, envelope.objects, true);
            await installLfsObjects(repository, envelope.objects);
            await verifyLfsObjects(repository, envelope.objects, false);
            returnedBundle = envelope.bundle.length === 0 ? null : envelope.bundle;
        }
        if (returnedBundle !== null) {
            const bundle = path.join(folder, 'return.bundle');
            await writeFile(bundle, returnedBundle, { mode: 0o600 });
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
        await verifyLfsTree(returned.head);
        await handOffGit(repository, ['worktree', 'add', '--detach', checkout, returned.head], {
            ...process.env,
            GIT_LFS_SKIP_SMUDGE: '1',
        });
        added = true;
        const patchPath = path.join(folder, 'return.patch');
        const patchNames: string[] = [];
        if (returned.patch !== null) {
            await writeFile(patchPath, returned.patch, { mode: 0o600 });
            const numstat = await git(['apply', '--numstat', '-z', patchPath], checkout);
            for (const row of numstat.split('\0').filter(Boolean)) {
                const name = row.split('\t').slice(2).join('\t');
                if (name === '' || isSecretPath(name))
                    throw new Error(
                        `Cloud patch contains a refused path: ${JSON.stringify(name)}.`
                    );
                patchNames.push(name);
            }
            await git(['apply', '--check', patchPath], checkout);
            await git(['apply', '--index', patchPath], checkout);
        }
        const returnedPointers = await verifyLfsTree((await git(['write-tree'], checkout)).trim());
        // A crash can occur after Git succeeds but before the phase journal is saved.
        // Compare canonical diffs, including newly added files, before deciding it is drift.
        const current = await readLocalTreeCheckpoint(cwd);
        const expectedPatch = await handOffGit(checkout, [
            'diff',
            ...handOffDiffOptions,
            'HEAD',
            '--',
        ]);
        if (
            current.branch === returned.branch &&
            current.head === returned.head &&
            current.patchHash === createHash('sha256').update(expectedPatch).digest('hex')
        )
            return;
        await assertLocalTreeMatches(cwd, baseline);
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
            if (carriedLfs === null)
                await git([
                    'checkout',
                    '--no-overwrite-ignore',
                    '-B',
                    baseline.branch,
                    returned.head,
                ]);
            else
                await handOffGit(
                    repository,
                    ['checkout', '--no-overwrite-ignore', '-B', baseline.branch, returned.head],
                    {
                        ...process.env,
                        GIT_LFS_SKIP_SMUDGE: '1',
                    }
                );
            if (returned.patch !== null) await git(['apply', patchPath]);
            if (carriedLfs !== null) {
                for (const name of patchNames) {
                    const filePath = path.join(repository, name);
                    const fileStat = await lstat(filePath).catch(() => null);
                    if (fileStat === null || !fileStat.isFile() || fileStat.size > 1024) continue;
                    const content = (await readFile(filePath)).toString();
                    const pointer =
                        /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([0-9a-f]{64})\r?\nsize ([0-9]{1,16})\r?\n$/u.exec(
                            content
                        );
                    if (pointer === null) {
                        if (content.startsWith('version https://git-lfs.github.com/spec/v1'))
                            throw new Error('Invalid Git LFS pointer.');
                        continue;
                    }
                    const object = carriedLfs.get(pointer[1] ?? '');
                    if (object === undefined || object.length !== Number(pointer[2]))
                        throw new Error(`Missing LFS object for ${JSON.stringify(name)}.`);
                    await writeFile(filePath, object);
                }
                await git(['lfs', 'checkout']);
                for (const file of returnedPointers) {
                    const filePath = path.resolve(repository, file.name);
                    const relative = path.relative(repository, filePath);
                    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
                        throw new Error('Invalid LFS file path.');
                    const info = await lstat(filePath);
                    if (
                        !info.isFile() ||
                        info.size !== file.size ||
                        !(await readBoundedObject(filePath, file.size)).equals(
                            carriedLfs.get(file.oid) ?? Buffer.alloc(0)
                        )
                    )
                        throw new Error(
                            `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) could not be materialized.`
                        );
                }
            }
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
