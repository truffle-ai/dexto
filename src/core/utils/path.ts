import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';
import { ConfigError } from '@core/config/errors.js';
/**
 * Default config file path (relative to package root)
 */
export const DEFAULT_CONFIG_PATH = 'agents/agent.yml';

/**
 * User's global config path (relative to home directory)
 */
export const USER_CONFIG_PATH = '.dexto/agent.yml';

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

    while (currentPath !== rootPath) {
        if (predicate(currentPath)) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }

    return null;
}

/**
 * Check if directory has dexto as dependency (MOST RELIABLE)
 * @param dirPath Directory to check
 * @returns True if directory contains dexto as dependency
 */
function hasDextoDependency(dirPath: string): boolean {
    const packageJsonPath = path.join(dirPath, 'package.json');

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        // Case 1: This IS the dexto package itself (local testing)
        if (pkg.name === 'dexto') {
            return true;
        }

        // Case 2: Project using dexto as dependency (SDK/CLI in project)
        const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
        };

        return 'dexto' in allDeps;
    } catch {
        return false;
    }
}

/**
 * Check if we're currently in a dexto project
 * @param startPath Starting directory path
 * @returns True if in a dexto project
 */
export function isDextoProject(startPath: string = process.cwd()): boolean {
    return getDextoProjectRoot(startPath) !== null;
}

/**
 * Check if we're currently in the dexto source code itself
 * @param startPath Starting directory path
 * @returns True if in dexto source code (package.name === 'dexto')
 */
export function isDextoSourceCode(startPath: string = process.cwd()): boolean {
    const projectRoot = getDextoProjectRoot(startPath);
    if (!projectRoot) return false;

    try {
        const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
        return pkg.name === 'dexto';
    } catch {
        return false;
    }
}

/**
 * Get dexto project root (or null if not in project)
 * @param startPath Starting directory path
 * @returns Project root directory or null
 */
export function getDextoProjectRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, hasDextoDependency);
}

/**
 * Standard path resolver for logs/db/config/anything in dexto projects
 * @param type Path type (logs, database, config, etc.)
 * @param filename Optional filename to append
 * @param startPath Starting directory for project detection
 * @returns Absolute path to the requested location
 */
export function getDextoPath(type: string, filename?: string, startPath?: string): string {
    const projectRoot = getDextoProjectRoot(startPath);

    let basePath: string;

    if (projectRoot) {
        // In dexto project: /project/.dexto/logs/
        basePath = path.join(projectRoot, '.dexto', type);
    } else {
        // Global: ~/.dexto/logs/
        basePath = path.join(homedir(), '.dexto', type);
    }

    return filename ? path.join(basePath, filename) : basePath;
}

/**
 * Global path resolver that ALWAYS returns paths in the user's home directory
 * Used for agent registry and other global-only resources that should not be project-relative
 * @param type Path type (agents, cache, etc.)
 * @param filename Optional filename to append
 * @returns Absolute path to the global location (~/.dexto/...)
 */
export function getDextoGlobalPath(type: string, filename?: string): string {
    // ALWAYS return global path, ignore project context
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
 * Resolve config path with registry and context awareness
 * @param nameOrPath Optional agent name or config path
 * @returns Absolute path to config file
 */
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

export async function resolveConfigPath(nameOrPath?: string): Promise<string> {
    // Default case: no name/path specified - use registry default-agent
    if (!nameOrPath) {
        const { getAgentRegistry } = await import('../agent-registry/registry.js');
        const registry = getAgentRegistry();
        return await registry.resolveAgent('default-agent');
    }

    // Check if it looks like a file path
    if (isPath(nameOrPath)) {
        // File path - resolve directly
        return path.resolve(nameOrPath);
    }

    // Registry name - use agent registry
    const { getAgentRegistry } = await import('../agent-registry/registry.js');
    const registry = getAgentRegistry();
    return await registry.resolveAgent(nameOrPath);
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
    try {
        // Try to resolve from the installed package
        const require = createRequire(import.meta.url);
        const packageJsonPath = require.resolve('dexto/package.json');
        const packageRoot = path.dirname(packageJsonPath);
        return path.resolve(packageRoot, scriptPath);
    } catch {
        // Fallback for development
        const packageRoot = findPackageRoot();
        if (!packageRoot) {
            throw new Error(`Cannot resolve bundled script: ${scriptPath}`);
        }
        return path.resolve(packageRoot, scriptPath);
    }
}

/**
 * Ensure ~/.dexto directory exists for global storage
 */
export async function ensureDextoGlobalDirectory(): Promise<void> {
    const dextoDir = path.join(homedir(), '.dexto');
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
    const projectRoot = getDextoProjectRoot(startPath);

    if (projectRoot) {
        // In dexto project: save to project .env
        return path.join(projectRoot, '.env');
    } else {
        // Global usage: save to ~/.dexto/.env
        return path.join(homedir(), '.dexto', '.env');
    }
}

/**
 * Get the user's global config path
 * @returns Absolute path to ~/.dexto/agent.yml
 */
export function getUserConfigPath(): string {
    return path.join(homedir(), USER_CONFIG_PATH);
}

/**
 * Get the bundled config path
 * @returns Absolute path to bundled agent.yml
 */
export function getBundledConfigPath(): string {
    return resolveBundledScript(DEFAULT_CONFIG_PATH);
}

/**
 * Check if a config path is the bundled config
 * @param configPath Path to check
 * @returns True if this is the bundled config
 */
export function isUsingBundledConfig(configPath: string): boolean {
    try {
        return configPath === getBundledConfigPath();
    } catch {
        return false;
    }
}
