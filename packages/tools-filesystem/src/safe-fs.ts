/**
 * Symlink-safe filesystem helpers.
 *
 * `fs.realpath` only works for paths that already exist. For paths that do not exist yet
 * (new files, new directories) we canonicalize the nearest existing ancestor and resolve
 * dangling symlinks ourselves, so policy checks always see where a write will really land.
 */

import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BufferEncoding } from './types.js';

/** Maximum number of symlinks followed while canonicalizing one path (matches Linux ELOOP). */
const MAX_SYMLINK_FOLLOWS = 40;

function errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
}

function fsError(code: string, message: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(message);
    error.code = code;
    return error;
}

export type CanonicalizeOptions = {
    /**
     * When false, a symlink in the final component is not followed: the result is the canonical
     * parent joined with the link's own name. Use this for operations that act on the link
     * itself (delete, rename source).
     */
    followFinalSymlink?: boolean;
};

/**
 * Resolve an absolute path to its canonical form, following every symlink that exists on disk,
 * including a dangling symlink in the final component. Missing trailing components are appended
 * to the canonical form of their nearest existing ancestor.
 *
 * Throws ELOOP when more than {@link MAX_SYMLINK_FOLLOWS} symlinks have to be followed.
 */
export async function canonicalizePath(
    targetPath: string,
    options: CanonicalizeOptions = {}
): Promise<string> {
    const absolute = path.resolve(targetPath);
    if (options.followFinalSymlink === false) {
        const parent = path.dirname(absolute);
        if (parent === absolute) {
            return absolute;
        }
        const canonicalParent = await canonicalizeInternal(parent, { follows: 0 });
        return path.join(canonicalParent, path.basename(absolute));
    }
    return canonicalizeInternal(absolute, { follows: 0 });
}

async function canonicalizeInternal(
    targetPath: string,
    budget: { follows: number }
): Promise<string> {
    try {
        return await fs.realpath(targetPath);
    } catch (error) {
        if (errorCode(error) === 'ELOOP') {
            throw error;
        }
    }

    const parent = path.dirname(targetPath);
    if (parent === targetPath) {
        return targetPath;
    }

    const canonicalParent = await canonicalizeInternal(parent, budget);
    const candidate = path.join(canonicalParent, path.basename(targetPath));

    let stats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
        stats = await fs.lstat(candidate);
    } catch {
        stats = undefined;
    }

    if (stats?.isSymbolicLink()) {
        budget.follows += 1;
        if (budget.follows > MAX_SYMLINK_FOLLOWS) {
            throw fsError('ELOOP', `Too many levels of symbolic links: ${targetPath}`);
        }
        // Dangling (or otherwise unresolvable) symlink: follow it manually so the caller sees
        // the location a write through this link would create.
        const linkTarget = await fs.readlink(candidate);
        return canonicalizeInternal(path.resolve(canonicalParent, linkTarget), budget);
    }

    return candidate;
}

/**
 * Create `canonicalDir` and any missing ancestors one level at a time, refusing to traverse a
 * symlink. `canonicalDir` must already be canonical, so any symlink met on the way was swapped
 * in after validation.
 */
export async function mkdirNoFollow(canonicalDir: string): Promise<boolean> {
    const parts: string[] = [];
    let current = path.resolve(canonicalDir);
    while (path.dirname(current) !== current) {
        parts.unshift(current);
        current = path.dirname(current);
    }

    let created = false;
    for (const part of parts) {
        let stats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
        try {
            stats = await fs.lstat(part);
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') {
                throw error;
            }
        }

        if (!stats) {
            try {
                await fs.mkdir(part);
                created = true;
            } catch (error) {
                if (errorCode(error) !== 'EEXIST') {
                    throw error;
                }
            }
            stats = await fs.lstat(part);
        }

        if (stats.isSymbolicLink()) {
            throw fsError('ELOOP', `Path changed during operation (symlink at ${part})`);
        }
        if (!stats.isDirectory()) {
            throw fsError('ENOTDIR', `Not a directory: ${part}`);
        }
    }
    return created;
}

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

async function openForWrite(
    canonicalPath: string
): Promise<{ handle: fs.FileHandle; created: boolean }> {
    try {
        const handle = await fs.open(
            canonicalPath,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW,
            0o666
        );
        return { handle, created: true };
    } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
            throw error;
        }
    }
    const handle = await fs.open(canonicalPath, fsConstants.O_WRONLY | O_NOFOLLOW);
    return { handle, created: false };
}

/**
 * Write a file at an already-validated canonical path without following symlinks.
 *
 * - Missing parent directories are created one level at a time without following symlinks.
 * - The final component is opened with O_NOFOLLOW, so a symlink swapped in after validation
 *   makes the open fail instead of writing through it.
 * - After opening, the path is canonicalized again and the opened inode is compared with the
 *   inode at that path. If any directory component changed into a symlink, or the canonical
 *   path is no longer accepted by `isAllowed`, nothing is written (a file this call created is
 *   removed again).
 * - The file is truncated only after these checks pass, so existing files are never clobbered
 *   through a redirected path.
 */
export async function writeFileNoFollow(
    canonicalPath: string,
    content: string,
    encoding: BufferEncoding,
    isAllowed: (canonicalPath: string) => boolean
): Promise<void> {
    await mkdirNoFollow(path.dirname(canonicalPath));

    const { handle, created } = await openForWrite(canonicalPath);
    let verified = false;
    let openedIno: { dev: number; ino: number } | undefined;
    try {
        const openedStats = await handle.stat();
        openedIno = { dev: openedStats.dev, ino: openedStats.ino };
        const recheckedPath = await canonicalizePath(canonicalPath);
        const pathStats = await fs.lstat(recheckedPath);

        if (
            recheckedPath !== canonicalPath ||
            !isAllowed(recheckedPath) ||
            !pathStats.isFile() ||
            pathStats.dev !== openedStats.dev ||
            pathStats.ino !== openedStats.ino
        ) {
            throw fsError(
                'EPERM',
                `Path changed during write and now resolves elsewhere: ${canonicalPath}`
            );
        }
        verified = true;

        await handle.truncate(0);
        await handle.writeFile(content, { encoding });
    } finally {
        await handle.close();
        if (!verified && created && openedIno) {
            await removeCreatedFile(canonicalPath, openedIno);
        }
    }
}

async function removeCreatedFile(
    canonicalPath: string,
    opened: { dev: number; ino: number }
): Promise<void> {
    // Best effort: only unlink if the entry at this path is still the empty file we created.
    try {
        const stats = await fs.stat(canonicalPath);
        if (stats.dev === opened.dev && stats.ino === opened.ino && stats.size === 0) {
            await fs.unlink(canonicalPath);
        }
    } catch {
        // Ignore cleanup failures; the write itself already failed.
    }
}
