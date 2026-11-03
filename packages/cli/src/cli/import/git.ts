// Finds the git repository a folder is in by reading `.git` on disk; git itself is never run.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * The repository `folder` is in: the main checkout's folder, so every worktree of one repository
 * names the same one, and its `origin` remote. Null when the folder is gone or in no repository.
 */
export async function findRepository(
    folder: string
): Promise<{ readonly remoteUrl: string | null; readonly root: string } | null> {
    const resolved = path.resolve(folder);
    if (!(await stat(resolved).catch(() => null))?.isDirectory()) return null;
    const found = await findDotGit(resolved);
    if (found === null) return null;
    const commonDir = await commonGitDir(found);
    if (commonDir === null) return null;
    const root =
        path.basename(commonDir) === '.git' ? path.dirname(commonDir) : path.dirname(found.path);
    const config = await readFile(path.join(commonDir, 'config'), 'utf8').catch(() => null);
    return { remoteUrl: config === null ? null : originUrl(config), root };
}

type FoundRepository = ReturnType<typeof findRepository>;

/** A lookup of `findRepository` that reads each folder once. */
export function createRepositoryFinder(): (folder: string | null) => FoundRepository {
    const found = new Map<string, FoundRepository>();
    return async (folder) => {
        if (folder === null) return null;
        let repository = found.get(folder);
        if (repository === undefined) {
            repository = findRepository(folder);
            found.set(folder, repository);
        }
        return await repository;
    };
}

/** The nearest `.git` at or above `folder`: a directory, or a worktree's `gitdir:` file. */
async function findDotGit(
    folder: string
): Promise<{ readonly kind: 'dir' | 'file'; readonly path: string } | null> {
    for (let current = folder; ; current = path.dirname(current)) {
        const candidate = path.join(current, '.git');
        const stats = await stat(candidate).catch(() => null);
        if (stats?.isDirectory()) return { kind: 'dir', path: candidate };
        if (stats?.isFile()) return { kind: 'file', path: candidate };
        if (path.dirname(current) === current) return null;
    }
}

/** The git directory shared by every worktree: a worktree's `gitdir`, then its `commondir`. */
async function commonGitDir(dotGit: {
    readonly kind: 'dir' | 'file';
    readonly path: string;
}): Promise<string | null> {
    if (dotGit.kind === 'dir') return dotGit.path;
    const pointer = await readFile(dotGit.path, 'utf8').catch(() => null);
    const gitDir = /^gitdir:\s*(.+)$/mu.exec(pointer ?? '')?.[1]?.trim();
    if (gitDir === undefined) return null;
    const worktreeDir = path.resolve(path.dirname(dotGit.path), gitDir);
    const common = await readFile(path.join(worktreeDir, 'commondir'), 'utf8').catch(() => null);
    return common === null ? worktreeDir : path.resolve(worktreeDir, common.trim());
}

/** `[remote "origin"] url = …` in a git config, without credentials. */
export function originUrl(config: string): string | null {
    let inOrigin = false;
    for (const raw of config.split(/\r?\n/u)) {
        const line = raw.trim();
        if (line.startsWith('[')) {
            inOrigin = /^\[remote\s+"origin"\]$/u.test(line);
            continue;
        }
        if (!inOrigin) continue;
        const url = /^url\s*=\s*(.+)$/u.exec(line)?.[1]?.trim();
        if (url !== undefined && url !== '') return withoutCredentials(url);
    }
    return null;
}

/**
 * A remote URL with userinfo, query and fragment removed, including scp-style userinfo.
 */
export function withoutCredentials(url: string): string {
    if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(url))
        return url.replace(/^[^/@]+@(?=[^/]+:)/u, '').split(/[?#]/u, 1)[0] ?? '';
    try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url.replace(/\/\/[^/@]*@/u, '//').split(/[?#]/u, 1)[0] ?? '';
    }
}
