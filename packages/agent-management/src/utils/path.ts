// TODO: (migration) This file is duplicated from @dexto/core for short-term compatibility
// This will become the primary location once core services accept paths via initialization

import * as path from 'path';
import { existsSync } from 'fs';
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
import type { Logger } from '@dexto/core';

/** Path segment for dexto worktrees directory */
const WORKTREE_DIR = '.dexto';
const WORKTREE_SUBDIR = 'worktree';

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

/**
 * Copy entire directory recursively
 * @param src Source directory path
 * @param dest Destination directory path
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
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
 * @param logger Optional logger instance for logging
 * @returns Absolute path to .env file for saving
 */
export function getDextoEnvPath(startPath: string = process.cwd(), logger?: Logger): string {
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
    logger?.debug(`Dexto env path: ${envPath}, context: ${context}`);
    return envPath;
}

/**
 * Check if a path is inside a Dexto worktree
 * @param checkPath Path to check (defaults to process.cwd())
 * @returns true if the path is inside a .dexto/worktree/ directory
 */
export function isInWorktree(checkPath: string = process.cwd()): boolean {
    const parts = checkPath.split(path.sep);
    return parts.some(
        (part, index) => part === WORKTREE_DIR && parts[index + 1] === WORKTREE_SUBDIR
    );
}

/**
 * Get the worktree root directory from a path
 * Returns the .dexto/worktree/<name> directory containing the worktree
 * @param checkPath Path to check
 * @returns Worktree root path or null if not in a worktree
 */
export function getWorktreeRootFromPath(checkPath: string): string | null {
    if (!isInWorktree(checkPath)) {
        return null;
    }

    const parts = checkPath.split(path.sep);
    const worktreeDirIndex = parts.findIndex(
        (part, index) => part === WORKTREE_DIR && parts[index + 1] === WORKTREE_SUBDIR
    );

    if (worktreeDirIndex === -1) {
        return null;
    }

    // Worktree root is the directory above worktree (the worktree name dir)
    // e.g., /project/.dexto/worktree/feature-x/ -> /project/.dexto/worktree/feature-x
    const rootParts = parts.slice(0, worktreeDirIndex + 3); // .dexto/worktree/<name>
    return rootParts.join(path.sep);
}

/**
 * Get the worktree name from a path
 * @param checkPath Path to check
 * @returns Worktree name or null if not in a worktree
 */
export function getWorktreeName(checkPath: string = process.cwd()): string | null {
    const root = getWorktreeRootFromPath(checkPath);
    if (!root) {
        return null;
    }

    // Worktree name is the last segment of the root path
    return path.basename(root);
}

/**
 * Get the parent project root from a worktree path
 * @param checkPath Path inside a worktree
 * @returns Parent project root path or null if not in a worktree
 */
export function getParentProjectRoot(checkPath: string = process.cwd()): string | null {
    const worktreeRoot = getWorktreeRootFromPath(checkPath);
    if (!worktreeRoot) {
        return null;
    }

    // Parent project is two levels up from the worktree root
    // .dexto/worktree/<name>/<subpath> -> project root
    const parts = worktreeRoot.split(path.sep);
    const parentParts = parts.slice(0, parts.length - 3); // Remove .dexto/worktree/<name>
    return parentParts.join(path.sep) || null;
}

/**
 * Get the worktree context if in a worktree
 * Returns null if not in a worktree
 * @param checkPath Path to check
 * @returns Worktree context or null
 */
export function getWorktreeContext(checkPath: string = process.cwd()): {
    name: string;
    root: string;
    parentProjectRoot: string;
} | null {
    if (!isInWorktree(checkPath)) {
        return null;
    }

    const root = getWorktreeRootFromPath(checkPath);
    const name = getWorktreeName(checkPath);
    const parentProjectRoot = getParentProjectRoot(checkPath);

    if (!root || !name || !parentProjectRoot) {
        return null;
    }

    return {
        name,
        root,
        parentProjectRoot,
    };
}
