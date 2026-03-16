// packages/agent-management/src/utils/execution-context.ts
// TODO: (migration) This file is duplicated from @dexto/core for short-term compatibility
// This will become the primary location once core services accept paths via initialization

import { walkUpDirectories } from './fs-walk.js';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import * as path from 'path';

export type ExecutionContext = 'dexto-source' | 'dexto-project' | 'global-cli';

const FORCED_PROJECT_ROOT_MARKERS = [
    path.join('.dexto', 'deploy.json'),
    path.join('.dexto', 'cloud', 'bootstrap.json'),
    'coding-agent.yml',
    'coding-agent.yaml',
    path.join('agents', 'agent-registry.json'),
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    path.join('src', 'dexto', 'agents', 'coding-agent.yml'),
    path.join('src', 'dexto', 'agents', 'coding-agent.yaml'),
] as const;

function hasForcedProjectRootMarker(dirPath: string): boolean {
    return FORCED_PROJECT_ROOT_MARKERS.some((relativePath) =>
        existsSync(path.join(dirPath, relativePath))
    );
}

function getForcedProjectRoot(): string | null {
    const value = process.env.DEXTO_PROJECT_ROOT?.trim();
    if (!value) {
        return null;
    }

    try {
        const resolved = path.resolve(value);
        if (!statSync(resolved).isDirectory()) {
            return null;
        }

        const root = realpathSync(resolved);
        if (
            isDextoProjectDirectory(root) ||
            isDextoSourceDirectory(root) ||
            hasForcedProjectRootMarker(root)
        ) {
            return root;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Check if directory is the dexto source code itself
 * @param dirPath Directory to check
 * @returns True if directory contains the dexto source monorepo (top-level).
 */
function isDextoSourceDirectory(dirPath: string): boolean {
    const packageJsonPath = path.join(dirPath, 'package.json');

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        // Monorepo root must be named 'dexto-monorepo'. No other names are treated as source root.
        return pkg.name === 'dexto-monorepo';
    } catch {
        return false;
    }
}

/**
 * Check if directory is a project that uses dexto as dependency (but is not dexto source)
 * @param dirPath Directory to check
 * @returns True if directory has dexto as dependency but is not dexto source
 */
function isDextoProjectDirectory(dirPath: string): boolean {
    const packageJsonPath = path.join(dirPath, 'package.json');

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        // Not internal dexto packages themselves
        if (pkg.name === 'dexto' || pkg.name === '@dexto/core' || pkg.name === '@dexto/webui') {
            return false;
        }

        // Check if has dexto or @dexto/core as dependency
        const allDeps = {
            ...(pkg.dependencies ?? {}),
            ...(pkg.devDependencies ?? {}),
            ...(pkg.peerDependencies ?? {}),
        };

        return 'dexto' in allDeps || '@dexto/core' in allDeps;
    } catch {
        return false;
    }
}

/**
 * Find dexto source root directory
 * @param startPath Starting directory path
 * @returns Dexto source root directory or null if not found
 */
export function findDextoSourceRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, isDextoSourceDirectory);
}

/**
 * Find dexto project root directory (projects using dexto as dependency)
 * @param startPath Starting directory path
 * @returns Dexto project root directory or null if not found
 */
export function findDextoProjectRoot(startPath: string = process.cwd()): string | null {
    const forcedProjectRoot = getForcedProjectRoot();
    if (forcedProjectRoot) {
        return forcedProjectRoot;
    }
    return walkUpDirectories(startPath, isDextoProjectDirectory);
}

/**
 * Detect current execution context - standardized across codebase
 * @param startPath Starting directory path (defaults to process.cwd())
 * @returns Execution context
 */
export function getExecutionContext(startPath: string = process.cwd()): ExecutionContext {
    if (getForcedProjectRoot()) {
        return 'dexto-project';
    }

    // Check for Dexto source context first (most specific)
    if (findDextoSourceRoot(startPath)) {
        return 'dexto-source';
    }

    // Check for Dexto project context
    if (findDextoProjectRoot(startPath)) {
        return 'dexto-project';
    }

    // Default to global CLI context
    return 'global-cli';
}
