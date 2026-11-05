import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** Build using a private index; neither intent-to-add nor exclusions touch the user's staging. */
export async function buildWorkingTree(cwd: string): Promise<WorkingTree> {
    const folder = await mkdtemp(path.join(tmpdir(), 'dexto-move-'));
    const cleanup = () => rm(folder, { recursive: true, force: true });
    const git = async (args: string[], env = process.env): Promise<Buffer> => {
        const { stdout } = await exec('git', args, {
            cwd,
            env,
            encoding: 'buffer',
            maxBuffer: MAX_BUNDLE + 1,
        });
        return stdout;
    };
    try {
        const branch = (await git(['symbolic-ref', '--short', 'HEAD'])).toString().trim();
        const head_commit = (await git(['rev-parse', 'HEAD'])).toString().trim();
        // A full bundle carries history too. Refuse secrets in every reachable commit, including
        // files deleted before HEAD, rather than uploading them hidden in pack objects.
        const commits = (await git(['rev-list', head_commit])).toString().trim().split('\n');
        for (const commit of commits) {
            const names = (await git(['ls-tree', '-r', '--name-only', '-z', commit]))
                .toString()
                .split('\0');
            const secret = names.find(isSecretPath);
            if (secret !== undefined)
                throw new Error(
                    `The branch history contains a secret-shaped file: ${JSON.stringify(secret)}. Use a clean branch before moving.`
                );
        }
        const env = { ...process.env, GIT_INDEX_FILE: path.join(folder, 'index') };
        await git(['read-tree', head_commit], env);
        const candidates = (
            await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        )
            .toString()
            .split('\0')
            .filter(Boolean);
        const safe = candidates.filter((name) => !isSecretPath(name));
        // Literal NUL pathspecs preserve spaces, newlines and leading dashes.
        const pathspec = path.join(folder, 'paths');
        await writeFile(pathspec, safe.join('\0') + '\0');
        if (safe.length > 0)
            await git(
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
            [
                '--literal-pathspecs',
                'diff',
                '--binary',
                '--no-ext-diff',
                '--no-textconv',
                '--src-prefix=a/',
                '--dst-prefix=b/',
                head_commit,
                '--',
                ...safe,
            ],
            env
        );
        if (patch.length > MAX_PATCH) throw new Error('The working-tree patch exceeds 32 MiB.');
        const bundlePath = path.join(folder, 'tree.bundle');
        // Pin both exported refs in a private repository. A concurrent local commit must not
        // make the bundle carry an unscanned tree after the history check above.
        const bare = path.join(folder, 'repository.git');
        await git(['init', '--bare', bare]);
        await git(['--git-dir=' + bare, 'fetch', '--no-tags', cwd, head_commit]);
        await git(['--git-dir=' + bare, 'update-ref', `refs/heads/${branch}`, head_commit]);
        await git(['--git-dir=' + bare, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
        await git(['--git-dir=' + bare, 'bundle', 'create', bundlePath, 'HEAD', branch]);
        const bundle = await readFile(bundlePath);
        if (bundle.length > MAX_BUNDLE) throw new Error('The branch bundle exceeds 256 MiB.');
        return { branch, head_commit, bundle, patch: patch.length === 0 ? null : patch, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
