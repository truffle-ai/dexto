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

const MAX_SYMLINK_DEPTH = 40;

function errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
}

function symlinkLoopError(targetPath: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(
        `Too many levels of symbolic links: ${targetPath}`
    );
    error.code = 'ELOOP';
    return error;
}

/**
 * Resolve an absolute path to its canonical form, following every symlink that exists on disk,
 * including a dangling symlink in the final component. Missing trailing components are appended
 * to the canonical form of their nearest existing ancestor.
 *
 * Throws ELOOP when symlinks nest deeper than {@link MAX_SYMLINK_DEPTH}.
 */
export async function canonicalizePath(targetPath: string): Promise<string> {
    return canonicalizeInternal(path.resolve(targetPath), 0);
}

async function canonicalizeInternal(targetPath: string, depth: number): Promise<string> {
    if (depth > MAX_SYMLINK_DEPTH) {
        throw symlinkLoopError(targetPath);
    }

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

    const canonicalParent = await canonicalizeInternal(parent, depth + 1);
    const candidate = path.join(canonicalParent, path.basename(targetPath));

    let stats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
        stats = await fs.lstat(candidate);
    } catch {
        stats = undefined;
    }

    if (stats?.isSymbolicLink()) {
        // Dangling (or otherwise unresolvable) symlink: follow it manually so the caller sees
        // the location a write through this link would create.
        const linkTarget = await fs.readlink(candidate);
        return canonicalizeInternal(path.resolve(canonicalParent, linkTarget), depth + 1);
    }

    return candidate;
}

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

/**
 * Write a file at an already-validated canonical path without following symlinks.
 *
 * - The final component is opened with O_NOFOLLOW, so a symlink swapped in after validation
 *   makes the open fail instead of writing through it.
 * - After opening, the path is canonicalized again and the opened inode is compared with the
 *   inode at that path. If any directory component changed into a symlink, or the canonical
 *   path is no longer accepted by `isAllowed`, nothing is written.
 * - The file is truncated only after these checks pass, so existing files are never clobbered
 *   through a redirected path.
 */
export async function writeFileNoFollow(
    canonicalPath: string,
    content: string,
    encoding: BufferEncoding,
    isAllowed: (canonicalPath: string) => boolean
): Promise<void> {
    const handle = await fs.open(
        canonicalPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | O_NOFOLLOW,
        0o666
    );
    try {
        const [openedStats, recheckedPath] = await Promise.all([
            handle.stat(),
            canonicalizePath(canonicalPath),
        ]);
        const pathStats = await fs.lstat(recheckedPath);

        if (
            recheckedPath !== canonicalPath ||
            !isAllowed(recheckedPath) ||
            !pathStats.isFile() ||
            pathStats.dev !== openedStats.dev ||
            pathStats.ino !== openedStats.ino
        ) {
            throw new Error(`Path changed during write and now resolves outside: ${canonicalPath}`);
        }

        await handle.truncate(0);
        await handle.writeFile(content, { encoding });
    } finally {
        await handle.close();
    }
}
