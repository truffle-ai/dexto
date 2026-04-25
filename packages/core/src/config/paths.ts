/**
 * Core path configuration
 *
 * This module allows injecting global paths from the host (CLI/Server)
 * into core services, avoiding direct filesystem dependencies in core.
 */

export const CorePaths = {
    /** Global ~/.dexto/cache directory */
    globalCacheDir: '',
    /** Global ~/.dexto/deps directory */
    globalDepsDir: '',
    /** Path to auth.json file */
    globalAuthPath: '',
};

/**
 * Initialize core paths from the host environment
 * @param paths Partial path configuration
 */
export function initializeCorePaths(paths: Partial<typeof CorePaths>) {
    if (paths.globalCacheDir) CorePaths.globalCacheDir = paths.globalCacheDir;
    if (paths.globalDepsDir) CorePaths.globalDepsDir = paths.globalDepsDir;
    if (paths.globalAuthPath) CorePaths.globalAuthPath = paths.globalAuthPath;
}
