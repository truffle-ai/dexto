// TODO: (migration) This file is duplicated from @dexto/core for short-term compatibility
// This will become the primary location once path utilities are fully migrated

import * as path from 'path';

/**
 * Generic directory walker that searches up the directory tree
 * @param startPath Starting directory path
 * @param predicate Function that returns true when the desired condition is found
 * @returns The directory path where the condition was met, or null if not found
 */
export function walkUpDirectories(
    startPath: string,
    predicate: (dirPath: string) => boolean
): string | null {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (true) {
        if (predicate(currentPath)) {
            return currentPath;
        }
        if (currentPath === rootPath) break;
        const parent = path.dirname(currentPath);
        if (parent === currentPath) break; // safety for exotic paths
        currentPath = parent;
    }

    return null;
}
