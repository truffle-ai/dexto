// TODO: (migration) This file is duplicated from @dexto/core for short-term compatibility
// This will become the primary location once core services accept paths via initialization

import * as path from 'path';
import { existsSync, type BigIntStats } from 'fs';
import { constants as fsConstants } from 'fs/promises';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { walkUpDirectories } from './fs-walk.js';
import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
} from './execution-context.js';

/**
 * Returns the package root for standalone binary installs.
 *
 * This is intentionally `undefined` for normal npm/pnpm installs.
 * The env var is set by the CLI bootstrap (`packages/cli/src/index.ts`)
 * when it detects executable-based distribution layout.
 */
export function getDextoPackageRoot(): string | undefined {
    const packageRoot = process.env.DEXTO_PACKAGE_ROOT;
    return typeof packageRoot === 'string' && packageRoot.length > 0 ? packageRoot : undefined;
}

/**
 * Standard path resolver for logs/db/config/anything in dexto projects
 * Context-aware with dev mode support:
 * - dexto-source + DEXTO_DEV_MODE=true: Use local repo .dexto (isolated testing)
 * - dexto-source (normal): Use global ~/.dexto (user experience)
 * - dexto-project: Use project-local .dexto
 * - global-cli: Use global ~/.dexto
 * @param type Path type (logs, database, config, etc.)
 * @param filename Optional filename to append
 * @param startPath Starting directory for project detection
 * @returns Absolute path to the requested location
 */
export function getDextoPath(type: string, filename?: string, startPath?: string): string {
    const context = getExecutionContext(startPath);

    let basePath: string;

    switch (context) {
        case 'dexto-source': {
            // Dev mode: use local repo .dexto for isolated testing
            // Normal mode: use global ~/.dexto for user experience
            const isDevMode = process.env.DEXTO_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findDextoSourceRoot(startPath);
                if (!sourceRoot) {
                    throw new Error('Not in dexto source context');
                }
                basePath = path.join(sourceRoot, '.dexto', type);
            } else {
                basePath = path.join(homedir(), '.dexto', type);
            }
            break;
        }
        case 'dexto-project': {
            const projectRoot = findDextoProjectRoot(startPath);
            if (!projectRoot) {
                throw new Error('Not in dexto project context');
            }
            basePath = path.join(projectRoot, '.dexto', type);
            break;
        }
        case 'global-cli': {
            basePath = path.join(homedir(), '.dexto', type);
            break;
        }
        default: {
            throw new Error(`Unknown execution context: ${context}`);
        }
    }

    return filename ? path.join(basePath, filename) : basePath;
}

/**
 * Global path resolver for user-global resources that should not be project-relative.
 *
 * Dev mode support:
 * - dexto-source + DEXTO_DEV_MODE=true: Use repo-local `.dexto` (isolated testing)
 * - otherwise: Use global `~/.dexto` (user experience)
 * @param type Path type (agents, cache, etc.)
 * @param filename Optional filename to append
 * @returns Absolute path to the global location (~/.dexto/...)
 */
export function getDextoGlobalPath(type: string, filename?: string): string {
    const isDevMode = process.env.DEXTO_DEV_MODE === 'true';
    if (isDevMode && getExecutionContext() === 'dexto-source') {
        const sourceRoot = findDextoSourceRoot();
        if (!sourceRoot) {
            throw new Error('Not in dexto source context');
        }

        const devBasePath = path.join(sourceRoot, '.dexto', type);
        return filename ? path.join(devBasePath, filename) : devBasePath;
    }

    const basePath = path.join(homedir(), '.dexto', type);
    return filename ? path.join(basePath, filename) : basePath;
}

function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * True when `candidate` resolves, after following every link, to `root` or something inside it.
 * A missing path or any resolution error counts as outside.
 */
export async function resolvesInside(root: string, candidate: string): Promise<boolean> {
    try {
        const [physicalRoot, physicalCandidate] = await Promise.all([
            fs.realpath(root),
            fs.realpath(candidate),
        ]);
        return isInside(physicalRoot, physicalCandidate);
    } catch {
        return false;
    }
}

/**
 * Copy entire directory recursively.
 *
 * Links are never followed out of the source, even if someone swaps one in while the copy runs:
 * - The source itself must not be a link (it is refused).
 * - A link that resolves outside `src` is skipped, a link to a directory is skipped, and a link
 *   to a file inside `src` is copied as a regular file.
 * - Every directory is opened and checked before and after it is listed, and every file is opened
 *   and checked before it is read, so what is copied is what was checked. Any mismatch (a path
 *   that now points somewhere else or outside `src`) aborts the whole copy with an error.
 * @param src Source directory path
 * @param dest Destination directory path
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
    // The source root is the boundary for every link below it, so it must not be a link itself.
    if ((await fs.lstat(src)).isSymbolicLink()) {
        throw new Error(`Refusing to copy ${src}: the source directory is a symbolic link`);
    }
    const rootReal = await fs.realpath(src);
    await copyDirectoryWithin(src, dest, rootReal);
}

const { O_RDONLY, O_DIRECTORY = 0, O_NOFOLLOW = 0 } = fsConstants;

/**
 * Throws unless `opened` (the stat of the handle we hold) is the same file or directory that
 * `target` names right now, and that path resolves inside `root`. Opening happens before this check, so whatever was opened is what gets verified.
 */
async function assertOpenedIsInside(
    opened: BigIntStats,
    target: string,
    root: string
): Promise<void> {
    const sameAsOpened = (named: BigIntStats) =>
        named.isDirectory() === opened.isDirectory() &&
        named.isFile() === opened.isFile() &&
        named.dev === opened.dev &&
        named.ino === opened.ino;

    const before = await fs.lstat(target, { bigint: true });
    const resolved = await fs.realpath(target);
    const after = await fs.lstat(target, { bigint: true });
    if (!sameAsOpened(before) || !sameAsOpened(after) || !isInside(root, resolved)) {
        throw new Error(`Refusing to copy ${target}: it changed while it was being copied`);
    }
}

async function copyDirectoryWithin(src: string, dest: string, rootReal: string): Promise<void> {
    // Windows cannot open a directory; there the checks below compare the path with itself.
    const handle =
        process.platform === 'win32'
            ? undefined
            : await fs.open(src, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    try {
        const opened = handle
            ? await handle.stat({ bigint: true })
            : await fs.lstat(src, { bigint: true });
        await assertOpenedIsInside(opened, src, rootReal);

        await fs.mkdir(dest, { recursive: true });
        const names = await fs.readdir(src);
        await assertOpenedIsInside(opened, src, rootReal);

        for (const name of names) {
            const srcPath = path.join(src, name);
            const destPath = path.join(dest, name);
            const entry = await fs.lstat(srcPath);

            if (entry.isSymbolicLink()) {
                const target = await fs.realpath(srcPath).catch(() => undefined);
                if (target === undefined || !isInside(rootReal, target)) continue;
                if (!(await fs.stat(target)).isFile()) continue;
                await copyFileWithin(target, destPath, rootReal);
            } else if (entry.isDirectory()) {
                await copyDirectoryWithin(srcPath, destPath, rootReal);
            } else if (entry.isFile()) {
                await copyFileWithin(srcPath, destPath, rootReal);
            }
        }
        await assertOpenedIsInside(opened, src, rootReal);
    } finally {
        await handle?.close();
    }
}

/** Reads the file through a handle that was checked to be the in-root file, not by path. */
async function copyFileWithin(src: string, dest: string, rootReal: string): Promise<void> {
    const handle = await fs.open(src, O_RDONLY | O_NOFOLLOW);
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile()) {
            throw new Error(`Refusing to copy ${src}: it is no longer a regular file`);
        }
        await assertOpenedIsInside(opened, src, rootReal);
        await fs.writeFile(dest, handle.createReadStream({ autoClose: false }));
        await fs.chmod(dest, Number(opened.mode & 0o777n));
    } finally {
        await handle.close();
    }
}

/**
 * Check if string looks like a file path vs registry name
 * @param str String to check
 * @returns True if looks like a path, false if looks like a registry name
 */
export function isPath(str: string): boolean {
    // Absolute paths
    if (path.isAbsolute(str)) return true;

    // Relative paths with separators
    if (/[\\/]/.test(str)) return true;

    // File extensions
    if (/\.(ya?ml|json)$/i.test(str)) return true;

    return false;
}

/**
 * Find package root (for other utilities)
 * @param startPath Starting directory path
 * @returns Directory containing package.json or null
 */
export function findPackageRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, (dirPath) => {
        const pkgPath = path.join(dirPath, 'package.json');
        return existsSync(pkgPath);
    });
}

/**
 * Resolve bundled script paths for MCP servers
 * @param scriptPath Relative script path
 * @returns Absolute path to bundled script
 */
export function resolveBundledScript(scriptPath: string): string {
    // Build list of candidate relative paths to try, favoring packaged (dist) first
    const candidates = scriptPath.startsWith('dist/')
        ? [scriptPath, scriptPath.replace(/^dist\//, '')]
        : [`dist/${scriptPath}`, scriptPath];

    // Keep a list of absolute paths we attempted for better diagnostics
    const triedAbs: string[] = [];

    const tryRoots = (roots: Array<string | null | undefined>): string | null => {
        for (const root of roots) {
            if (!root) continue;
            for (const rel of candidates) {
                const abs = path.resolve(root, rel);
                if (existsSync(abs)) return abs;
                triedAbs.push(abs);
            }
        }
        return null;
    };

    // 0) Explicit env override (useful for exotic/linked setups)
    const envRoot = getDextoPackageRoot();
    const fromEnv = tryRoots([envRoot]);
    if (fromEnv) return fromEnv;

    // 1) Try to resolve from installed CLI package root (global/local install)
    try {
        const require = createRequire(import.meta.url);
        const pkgJson = require.resolve('dexto/package.json');
        const pkgRoot = path.dirname(pkgJson);
        const fromPkg = tryRoots([pkgRoot]);
        if (fromPkg) return fromPkg;
    } catch {
        // ignore, fall through to dev/project resolution
    }

    // 2) Development fallback anchored to this module's location (monorepo source)
    try {
        const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));
        const sourceRoot = findDextoSourceRoot(thisModuleDir);
        const fromSource = tryRoots([sourceRoot ?? undefined]);
        if (fromSource) return fromSource;
    } catch {
        // ignore and continue to legacy fallback
    }

    // 3) Legacy fallback: repo/project root derived from CWD
    const repoRoot = findPackageRoot();
    const fromCwd = tryRoots([repoRoot ?? undefined]);
    if (fromCwd) return fromCwd;

    // Not found anywhere: throw with helpful message and absolute paths attempted
    throw new Error(
        `Bundled script not found: ${scriptPath} (tried absolute: ${triedAbs.join(', ')})`
    );
}

/**
 * Ensure ~/.dexto directory exists for global storage
 */
export async function ensureDextoGlobalDirectory(): Promise<void> {
    const dextoDir = getDextoGlobalPath('');
    try {
        await fs.mkdir(dextoDir, { recursive: true });
    } catch (error) {
        // Directory might already exist, ignore EEXIST errors
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Get the appropriate .env file path for saving API keys.
 * Uses the same project detection logic as other dexto paths.
 *
 * @param startPath Starting directory for project detection
 * @returns Absolute path to .env file for saving
 */
export function getDextoEnvPath(startPath: string = process.cwd()): string {
    const context = getExecutionContext(startPath);
    let envPath = '';
    switch (context) {
        case 'dexto-source': {
            // Dev mode: use local repo .env for isolated testing
            // Normal mode: use global ~/.dexto/.env for user experience
            const isDevMode = process.env.DEXTO_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findDextoSourceRoot(startPath);
                if (!sourceRoot) {
                    throw new Error('Not in dexto source context');
                }
                envPath = path.join(sourceRoot, '.env');
            } else {
                envPath = path.join(homedir(), '.dexto', '.env');
            }
            break;
        }
        case 'dexto-project': {
            const projectRoot = findDextoProjectRoot(startPath);
            if (!projectRoot) {
                throw new Error('Not in dexto project context');
            }
            envPath = path.join(projectRoot, '.env');
            break;
        }
        case 'global-cli': {
            envPath = path.join(homedir(), '.dexto', '.env');
            break;
        }
    }
    // logger.debug(`Dexto env path: ${envPath}, context: ${context}`); // TODO: (migration) Removed logger dependency
    return envPath;
}
