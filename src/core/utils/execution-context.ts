// src/core/utils/execution-context.ts

import { walkUpDirectories } from './path.js';
import { readFileSync } from 'fs';
import * as path from 'path';

export type ExecutionContext = 'dexto-source' | 'dexto-project' | 'global-cli';

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
 * Get dexto project root (or null if not in project)
 * @param startPath Starting directory path
 * @returns Project root directory or null
 */
export function getDextoProjectRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, hasDextoDependency);
}

/**
 * Detect current execution context - standardized across codebase
 * @param startPath Starting directory path (defaults to process.cwd())
 * @returns Execution context
 */
export function getExecutionContext(startPath: string = process.cwd()): ExecutionContext {
    // Check for Dexto source context first (most specific)
    if (isDextoSourceCode(startPath)) {
        return 'dexto-source';
    }

    // Check for Dexto project context
    if (getDextoProjectRoot(startPath)) {
        return 'dexto-project';
    }

    // Default to global CLI context
    return 'global-cli';
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
 * Check if running in global CLI context (outside any dexto project)
 */
export function isGlobalCLI(startPath?: string): boolean {
    return getExecutionContext(startPath) === 'global-cli';
}

/**
 * Check if running in a dexto project context (not source code)
 */
export function isDextoProject(startPath?: string): boolean {
    return getExecutionContext(startPath) === 'dexto-project';
}

/**
 * Get human-readable context description for logging/debugging
 */
export function getContextDescription(context: ExecutionContext): string {
    switch (context) {
        case 'dexto-source':
            return 'Dexto source code development';
        case 'dexto-project':
            return 'Dexto project';
        case 'global-cli':
            return 'Global CLI usage';
    }
}
