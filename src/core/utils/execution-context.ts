// src/core/utils/execution-context.ts

import { getDextoProjectRoot, isDextoSourceCode } from './path.js';

export type ExecutionContext = 'dexto-source' | 'dexto-project' | 'global-cli';

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
 * Check if running in dexto source code context
 */
export function isInDextoSource(startPath?: string): boolean {
    return getExecutionContext(startPath) === 'dexto-source';
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
