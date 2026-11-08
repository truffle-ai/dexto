import { constants as fsConstants, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export type BackupCopyPlatform = {
    /** `O_NOFOLLOW`, which does not exist on Windows. */
    noFollow: number | undefined;
    /** Runs between the `lstat` and the open. Tests use it to swap the source deterministically. */
    beforeOpen?: () => Promise<void>;
};

/**
 * Copy a regular file without following a symlink at either end. An existing destination
 * (including a symlink) fails with EEXIST, so a backup never writes outside the paths it was
 * given.
 *
 * `lstat` refuses a symlink or junction up front. Where `O_NOFOLLOW` exists the open also refuses
 * a link. Where it does not (Windows), a link swapped in after the `lstat` would be followed, so
 * the opened descriptor must be the very file `lstat` saw (same device and inode), and a
 * filesystem that reports no inode cannot prove that: the backup is refused.
 */
export async function copyWithoutFollowingLinks(
    source: string,
    destination: string,
    platform: BackupCopyPlatform = { noFollow: fsConstants.O_NOFOLLOW }
): Promise<void> {
    const linkStats = await fs.lstat(source);
    if (!linkStats.isFile()) {
        throw new Error('Only regular files can be backed up');
    }

    await platform.beforeOpen?.();
    const input = await fs.open(source, fsConstants.O_RDONLY | (platform.noFollow ?? 0));
    try {
        const stats = await input.stat();
        if (!stats.isFile()) {
            throw new Error('Only regular files can be backed up');
        }
        assertSameFile(linkStats, stats, platform.noFollow !== undefined);
        const output = await fs.open(destination, 'wx', stats.mode & 0o777);
        await pipeline(input.createReadStream({ autoClose: false }), output.createWriteStream());
    } finally {
        await input.close();
    }
}

/** Throws unless the opened file is the one `lstat` saw. Size and mtime are not an identity. */
export function assertSameFile(
    linkStats: Pick<Stats, 'dev' | 'ino'>,
    openedStats: Pick<Stats, 'dev' | 'ino'>,
    hasNoFollow: boolean
): void {
    if (!hasNoFollow && (linkStats.ino === 0 || openedStats.ino === 0)) {
        throw new Error(
            'Cannot safely back up on this platform: file identity is unavailable without O_NOFOLLOW'
        );
    }
    if (linkStats.ino !== openedStats.ino || linkStats.dev !== openedStats.dev) {
        throw new Error('Source changed while backing up');
    }
}
