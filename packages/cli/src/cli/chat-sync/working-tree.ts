import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readFile, realpath, rm, writeFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { isSecretPath } from './redaction.js';
import { handOffGit, handOffDiffOptions } from './git.js';
import { CommandFailure } from '../failure.js';
import { packLfsEnvelope } from './lfs-envelope.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const MAX_BUNDLE = 256 * 1024 * 1024;
const MAX_PATCH = 32 * 1024 * 1024;
const run = promisify(execFile);

export async function listTreeLfsPointers(
    repository: string,
    tree: string
): Promise<{ name: string; oid: string; size: number }[]> {
    let names: string;
    try {
        names = (
            await run(
                'git',
                [
                    'grep',
                    '-l',
                    '-z',
                    '-I',
                    '-F',
                    'version https://git-lfs.github.com/spec/v1',
                    tree,
                    '--',
                ],
                { cwd: repository, maxBuffer: 64 * 1024 * 1024 }
            )
        ).stdout;
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1)
            return [];
        throw error;
    }
    const pointers: { name: string; oid: string; size: number }[] = [];
    for (const revision of names.split('\0').filter(Boolean)) {
        const size = Number(
            (await handOffGit(repository, ['cat-file', '-s', revision])).toString().trim()
        );
        if (size > 1024) continue;
        const content = (await handOffGit(repository, ['cat-file', 'blob', revision])).toString();
        const match =
            /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([0-9a-f]{64})\r?\nsize ([0-9]{1,16})\r?\n$/u.exec(
                content
            );
        if (match === null) {
            if (content.startsWith('version https://git-lfs.github.com/spec/v1'))
                throw new Error('Invalid Git LFS pointer.');
            continue;
        }
        const oid = match[1];
        const declaredSize = Number(match[2]);
        if (oid === undefined || !Number.isSafeInteger(declaredSize))
            throw new Error('Invalid Git LFS pointer size.');
        pointers.push({ name: revision.slice(tree.length + 1), oid, size: declaredSize });
    }
    return pointers;
}

async function lfsObjectsFolder(repository: string): Promise<string> {
    try {
        const configured = (
            await run('git', ['config', '--path', '--get', 'lfs.storage'], { cwd: repository })
        ).stdout.trim();
        const common = (
            await handOffGit(repository, [
                'rev-parse',
                '--path-format=absolute',
                '--git-common-dir',
            ])
        )
            .toString()
            .trim();
        return path.join(path.resolve(common, configured), 'objects');
    } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 1)
            throw error;
        return (
            await handOffGit(repository, [
                'rev-parse',
                '--path-format=absolute',
                '--git-path',
                'lfs/objects',
            ])
        )
            .toString()
            .trim();
    }
}

export async function readBoundedObject(objectPath: string, size: number): Promise<Buffer> {
    const file = await open(objectPath, 'r');
    try {
        const content = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < content.length) {
            const { bytesRead } = await file.read(content, offset, content.length - offset, null);
            if (bytesRead === 0) break;
            offset += bytesRead;
        }
        if (offset !== size) throw new Error('LFS object has an invalid size.');
        return content.subarray(0, size);
    } finally {
        await file.close();
    }
}

export async function verifyLfsObjects(
    repository: string,
    objects: readonly { oid: string; content: Buffer }[],
    allowMissing: boolean
): Promise<void> {
    const folder = await lfsObjectsFolder(repository);
    for (const object of objects) {
        const objectPath = path.join(
            folder,
            object.oid.slice(0, 2),
            object.oid.slice(2, 4),
            object.oid
        );
        const info = await lstat(objectPath).catch((error: unknown) => {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'ENOENT' &&
                allowMissing
            )
                return null;
            throw error;
        });
        if (info === null) continue;
        if (
            !info.isFile() ||
            info.size !== object.content.length ||
            !(await readBoundedObject(objectPath, object.content.length)).equals(object.content)
        )
            throw new Error(
                `The local LFS object ${object.oid} is invalid; preserve it and recover it before returning.`
            );
    }
}

export interface WorkingTree {
    readonly repository: string;
    readonly branch: string;
    readonly head_commit: string;
    readonly bundle: Buffer;
    readonly patch: Buffer | null;
    /** Changed, staged-new and untracked files carried by the patch. */
    readonly changedFiles: number;
    readonly cleanup: () => Promise<void>;
}

export interface LocalTreeCheckpoint {
    readonly branch: string;
    readonly head: string;
    readonly patchHash: string;
}

/**
 * The Git repository a hand-off moves. Only a project repository qualifies: a repository rooted at
 * the home directory (or above it) would carry every untracked file under home.
 */
export async function gitRepositoryRoot(cwd: string): Promise<string> {
    const folder = await realpath(cwd).catch(() => {
        throw new CommandFailure(
            'invalid_input',
            `The chat's working folder ${cwd} no longer exists.`,
            null
        );
    });
    const root = await handOffGit(folder, ['rev-parse', '--show-toplevel']).then(
        (output) => output.toString().replace(/\r?\n$/u, ''),
        () => {
            throw new CommandFailure(
                'invalid_input',
                `${cwd} is not inside a Git repository. Chat move hands off a Git project, so open the chat in a project folder that uses Git.`,
                null
            );
        }
    );
    const home = await realpath(homedir()).catch(() => homedir());
    const fromRoot = path.relative(await realpath(root), home);
    const outside =
        fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot);
    if (!outside)
        throw new CommandFailure(
            'invalid_input',
            `The Git repository at ${root} contains your home directory; move a project folder, not your home directory.`,
            null
        );
    return root;
}

async function refuseSecretTree(repository: string, commit: string): Promise<void> {
    const secret = (await handOffGit(repository, ['ls-tree', '-r', '--name-only', '-z', commit]))
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
        await handOffGit(repository, [
            'log',
            '--root',
            '--diff-merges=separate',
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
async function workingTreeFiles(cwd: string): Promise<{
    repository: string;
    branch: string;
    head_commit: string;
    patch: Buffer | null;
    changedFiles: number;
    snapshot: string;
}> {
    const repository = await gitRepositoryRoot(cwd);
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-move-index-'));
    try {
        const branch = (
            await handOffGit(repository, ['symbolic-ref', '--short', 'HEAD']).catch(() => {
                throw new CommandFailure(
                    'invalid_input',
                    'Check out a local branch before moving this chat.',
                    'git switch <branch>'
                );
            })
        )
            .toString()
            .trim();
        const head_commit = (await handOffGit(repository, ['rev-parse', 'HEAD'])).toString().trim();
        // Refuse tracked secret files before diff can read their contents.
        await refuseSecretTree(repository, head_commit);
        const env = { ...process.env, GIT_INDEX_FILE: path.join(folder, 'index') };
        await handOffGit(repository, ['read-tree', head_commit], env);
        const candidates = (
            await handOffGit(repository, ['ls-files', '--others', '--exclude-standard', '-z'], env)
        )
            .toString()
            .split('\0')
            .filter(Boolean);
        const [stagedOutput, deletedOutput] = await Promise.all([
            handOffGit(repository, [
                'diff',
                ...handOffDiffOptions,
                '--cached',
                '--name-only',
                '--diff-filter=A',
                '-z',
                head_commit,
                '--',
            ]),
            handOffGit(repository, ['ls-files', '--deleted', '-z']),
        ]);
        const deleted = new Set(deletedOutput.toString().split('\0'));
        const staged = stagedOutput
            .toString()
            .split('\0')
            .filter((name) => name !== '' && !deleted.has(name));
        const safe = [...new Set([...candidates, ...staged])].filter((name) => !isSecretPath(name));
        const pathspec = path.join(folder, 'paths');
        await writeFile(pathspec, safe.join('\0') + '\0');
        if (safe.length > 0)
            await handOffGit(
                repository,
                [
                    '--literal-pathspecs',
                    'add',
                    '-N',
                    '-f',
                    '--pathspec-from-file=' + pathspec,
                    '--pathspec-file-nul',
                ],
                env
            );
        const patch = await handOffGit(
            repository,
            ['--literal-pathspecs', 'diff', ...handOffDiffOptions, head_commit, '--'],
            env
        );
        if (patch.length > MAX_PATCH) throw new Error('The working-tree patch exceeds 32 MiB.');
        const changedFiles =
            patch.length === 0
                ? 0
                : (
                      await handOffGit(
                          repository,
                          [
                              '--literal-pathspecs',
                              'diff',
                              ...handOffDiffOptions,
                              '--name-only',
                              '-z',
                              head_commit,
                              '--',
                          ],
                          env
                      )
                  )
                      .toString()
                      .split('\0')
                      .filter(Boolean).length;
        await handOffGit(repository, ['add', '-u', '--', '.'], env);
        if (safe.length > 0)
            await handOffGit(
                repository,
                [
                    '--literal-pathspecs',
                    'add',
                    '-f',
                    '--pathspec-from-file=' + pathspec,
                    '--pathspec-file-nul',
                ],
                env
            );
        const snapshot = (await handOffGit(repository, ['write-tree'], env)).toString().trim();
        return {
            repository,
            branch,
            head_commit,
            patch: patch.length === 0 ? null : patch,
            changedFiles,
            snapshot,
        };
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
    const { repository, branch, head_commit, patch, changedFiles } = tree;
    // A full bundle carries deleted history too, so every reachable tree is checked.
    await refuseSecretHistory(repository, head_commit);
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-move-bundle-'));
    const cleanup = () => rm(folder, { recursive: true, force: true });
    try {
        const bundlePath = path.join(folder, 'tree.bundle');
        const bare = path.join(folder, 'repository.git');
        await handOffGit(repository, ['init', '--bare', bare]);
        await handOffGit(repository, [
            '--git-dir=' + bare,
            'fetch',
            '--no-tags',
            repository,
            head_commit,
        ]);
        await handOffGit(repository, [
            '--git-dir=' + bare,
            'update-ref',
            `refs/heads/${branch}`,
            head_commit,
        ]);
        await handOffGit(repository, [
            '--git-dir=' + bare,
            'symbolic-ref',
            'HEAD',
            `refs/heads/${branch}`,
        ]);
        await handOffGit(repository, [
            '--git-dir=' + bare,
            'bundle',
            'create',
            bundlePath,
            'HEAD',
            branch,
        ]);
        if ((await stat(bundlePath)).size > MAX_BUNDLE)
            throw new Error('The branch bundle exceeds 256 MiB.');
        const rawBundle = await readFile(bundlePath);
        const listing = await listTreeLfsPointers(repository, tree.snapshot);
        if (listing.length === 0) {
            if (rawBundle.length + (patch?.length ?? 0) > MAX_BUNDLE)
                throw new Error('The complete handoff exceeds 256 MiB.');
            return {
                repository,
                branch,
                head_commit,
                patch,
                changedFiles,
                bundle: rawBundle,
                cleanup,
            };
        }
        const objectsFolder = await lfsObjectsFolder(repository);
        const objects: { oid: string; content: Buffer }[] = [];
        let lastFile: { name: string; size: number } | null = null;
        let totalSize = rawBundle.length + (patch?.length ?? 0);
        for (const file of listing) {
            const previous = objects.find((object) => object.oid === file.oid);
            if (previous !== undefined) {
                if (previous.content.length !== file.size)
                    throw new Error(
                        `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) has an invalid size.`
                    );
                continue;
            }
            totalSize += file.size;
            if (totalSize > MAX_BUNDLE)
                throw new Error(
                    `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) exceeds the handoff limit.`
                );
            const objectPath = path.join(
                objectsFolder,
                file.oid.slice(0, 2),
                file.oid.slice(2, 4),
                file.oid
            );
            const objectStat = await stat(objectPath).catch(() => null);
            if (objectStat === null || !objectStat.isFile() || objectStat.size !== file.size)
                throw new Error(
                    `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) is missing or has an invalid size.`
                );
            const content = await readBoundedObject(objectPath, file.size).catch(() => {
                throw new Error(
                    `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) is missing from the local object store.`
                );
            });
            if (createHash('sha256').update(content).digest('hex') !== file.oid)
                throw new Error(
                    `LFS file ${JSON.stringify(file.name)} (${file.size} bytes) has an invalid checksum.`
                );
            objects.push({ oid: file.oid, content });
            lastFile = file;
        }
        let bundle: Buffer;
        try {
            bundle = objects.length === 0 ? rawBundle : packLfsEnvelope(rawBundle, objects);
        } catch (error) {
            if (lastFile === null) throw error;
            throw new Error(
                `LFS file ${JSON.stringify(lastFile.name)} (${lastFile.size} bytes) cannot fit in the handoff.`,
                { cause: error }
            );
        }
        if (bundle.length + (patch?.length ?? 0) > MAX_BUNDLE)
            throw new Error(
                lastFile === null
                    ? 'The complete handoff exceeds 256 MiB.'
                    : `LFS file ${JSON.stringify(lastFile.name)} (${lastFile.size} bytes) cannot fit in the handoff.`
            );
        return { repository, branch, head_commit, patch, changedFiles, bundle, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
