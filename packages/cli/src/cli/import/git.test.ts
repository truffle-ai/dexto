/** Verifies how a session's folder is traced to its repository and remote, from `.git` on disk. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepository, originUrl, withoutCredentials } from './git.js';

/** A main checkout with an `origin`, and a linked worktree of it, as `git worktree add` leaves them. */
export async function writeRepository(base: string, remote: string) {
    const main = path.join(base, 'dexto');
    const worktree = path.join(base, 'dexto-wt');
    const linked = path.join(main, '.git', 'worktrees', 'dexto-wt');
    await mkdir(path.join(main, 'packages', 'cli'), { recursive: true });
    await mkdir(linked, { recursive: true });
    await mkdir(path.join(worktree, 'src'), { recursive: true });
    await writeFile(
        path.join(main, '.git', 'config'),
        `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://example.com/other.git\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    );
    await writeFile(path.join(worktree, '.git'), `gitdir: ${linked}\n`);
    await writeFile(path.join(linked, 'commondir'), '../..\n');
    return { main, worktree };
}

describe('findRepository', () => {
    it('names the main checkout for a worktree and a subfolder alike, with its origin', async () => {
        const base = await mkdtemp(path.join(tmpdir(), 'git-'));
        const { main, worktree } = await writeRepository(
            base,
            'git@github.com:truffle-ai/dexto.git'
        );
        const expected = { remoteUrl: 'git@github.com:truffle-ai/dexto.git', root: main };

        expect(await findRepository(path.join(main, 'packages', 'cli'))).toEqual(expected);
        expect(await findRepository(path.join(worktree, 'src'))).toEqual(expected);
    });

    it('is null for a folder in no repository, or one that is gone', async () => {
        const base = await mkdtemp(path.join(tmpdir(), 'git-none-'));
        expect(await findRepository(base)).toBeNull();
        expect(await findRepository(path.join(base, 'deleted'))).toBeNull();
        const { main } = await writeRepository(base, 'git@github.com:a/b.git');
        expect(await findRepository(path.join(main, 'deleted'))).toBeNull();
    });

    it('uses the checkout as the root for a submodule', async () => {
        const base = await mkdtemp(path.join(tmpdir(), 'git-submodule-'));
        const { main } = await writeRepository(base, 'git@github.com:a/b.git');
        const checkout = path.join(main, 'sub');
        const gitdir = path.join(main, '.git', 'modules', 'sub');
        await mkdir(checkout, { recursive: true });
        await mkdir(gitdir, { recursive: true });
        await writeFile(path.join(checkout, '.git'), `gitdir: ${gitdir}\n`);
        await writeFile(
            path.join(gitdir, 'config'),
            '[remote "origin"]\nurl = git@github.com:a/sub.git\n'
        );
        expect(await findRepository(checkout)).toEqual({
            root: checkout,
            remoteUrl: 'git@github.com:a/sub.git',
        });
    });
});

describe('originUrl', () => {
    it('reads only the origin remote', () => {
        expect(originUrl('[remote "upstream"]\n\turl = a\n')).toBeNull();
        expect(originUrl('[remote "origin"]\n\turl = https://github.com/a/b.git\n')).toBe(
            'https://github.com/a/b.git'
        );
    });
});

describe('withoutCredentials', () => {
    it('leaves out a user, password or token, and any query', () => {
        expect(withoutCredentials('https://x-access-token:ghp_secret@github.com/a/b.git')).toBe(
            'https://github.com/a/b.git'
        );
        expect(withoutCredentials('https://ghp_secret@github.com/a/b.git?token=1#x')).toBe(
            'https://github.com/a/b.git'
        );
        expect(withoutCredentials('ssh://git@github.com/a/b.git')).toBe(
            'ssh://git@github.com/a/b.git'
        );
        expect(withoutCredentials('ssh://git:hunter2@github.com/a/b.git')).toBe(
            'ssh://github.com/a/b.git'
        );
        expect(withoutCredentials('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    });
});
