// packages/core/src/utils/execution-context.ts
// TODO: (migration) This file is duplicated in @dexto/agent-management for short-term compatibility
// Remove from core once all services accept paths via initialization options

import { walkUpDirectories } from './fs-walk.js';
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import {
    isInWorktree,
    getWorktreeRootFromPath,
    getWorktreeName,
    getParentProjectRoot,
} from './path.js';

export type ExecutionContext = 'dexto-source' | 'dexto-project' | 'global-cli' | 'worktree';

const DIRECT_PROJECT_ROOT_MARKERS = [
    path.join('.dexto', 'deploy.json'),
    path.join('.dexto', 'cloud', 'bootstrap.json'),
    'coding-agent.yml',
    'coding-agent.yaml',
    path.join('agents', 'registry.json'),
    path.join('agents', 'agent-registry.json'),
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    path.join('src', 'dexto', 'agents', 'coding-agent.yml'),
    path.join('src', 'dexto', 'agents', 'coding-agent.yaml'),
] as const;

function getCaseInsensitiveRootFilename(dirPath: string, filename: string): string | null {
    try {
        return (
            readdirSync(dirPath).find((entry) => entry.toLowerCase() === filename.toLowerCase()) ??
            null
        );
    } catch {
        return null;
    }
}

function hasWorkspaceAuthoringDirectory(dirPath: string, name: 'agents' | 'skills'): boolean {
    try {
        return statSync(path.join(dirPath, name)).isDirectory();
    } catch {
        return false;
    }
}

function hasDextoWorkspaceAgentsFile(dirPath: string): boolean {
    const agentsFilename = getCaseInsensitiveRootFilename(dirPath, 'agents.md');
    if (!agentsFilename) {
        return false;
    }

    try {
        const content = readFileSync(path.join(dirPath, agentsFilename), 'utf-8').toLowerCase();
        return content.includes('dexto workspace') || content.includes('dexto-workspace');
    } catch {
        return false;
    }
}

function hasWorkspaceScaffoldMarker(dirPath: string): boolean {
    return (
        hasDextoWorkspaceAgentsFile(dirPath) &&
        (hasWorkspaceAuthoringDirectory(dirPath, 'agents') ||
            hasWorkspaceAuthoringDirectory(dirPath, 'skills'))
    );
}

function readPackageName(dirPath: string): string | null {
    try {
        const pkg = JSON.parse(readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
        return typeof pkg.name === 'string' ? pkg.name : null;
    } catch {
        return null;
    }
}

function isInternalDextoPackage(dirPath: string): boolean {
    const packageName = readPackageName(dirPath);
    return packageName === 'dexto' || packageName?.startsWith('@dexto/') === true;
}

function hasProjectRootMarker(dirPath: string): boolean {
    if (hasWorkspaceScaffoldMarker(dirPath)) {
        return true;
    }

    return DIRECT_PROJECT_ROOT_MARKERS.some((relativePath) =>
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
            hasProjectRootMarker(root)
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
    return readPackageName(dirPath) === 'dexto-monorepo';
}

/**
 * Check if directory is a project that uses dexto as dependency (but is not dexto source)
 * @param dirPath Directory to check
 * @returns True if directory has dexto as dependency but is not dexto source
 */
function isDextoProjectDirectory(dirPath: string): boolean {
    if (isDextoSourceDirectory(dirPath)) {
        return false;
    }

    if (isInternalDextoPackage(dirPath)) {
        return false;
    }

    if (hasProjectRootMarker(dirPath)) {
        return true;
    }

    try {
        const pkg = JSON.parse(readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
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
 * Find the root of the Git repository containing the given path
 * Walks up looking for .git directory
 * @param startPath Starting directory path
 * @returns Git repository root or null if not in a git repo
 */
export function findGitRepoRoot(startPath: string = process.cwd()): string | null {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (currentPath !== rootPath) {
        if (existsSync(path.join(currentPath, '.git'))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }

    return null;
}

/**
 * Worktree context containing worktree information
 */
export interface WorktreeContextInfo {
    /** Worktree name */
    name: string;
    /** Absolute path to the worktree root */
    root: string;
    /** Absolute path to the parent project root */
    parentProjectRoot: string;
}

/**
 * Detect if running inside a worktree and return context info
 * @param startPath Starting directory path (defaults to process.cwd())
 * @returns Worktree context or null if not in a worktree
 */
export function getWorktreeContext(startPath: string = process.cwd()): WorktreeContextInfo | null {
    if (!isInWorktree(startPath)) {
        return null;
    }

    const root = getWorktreeRootFromPath(startPath);
    const name = getWorktreeName(startPath);
    const parentProjectRoot = getParentProjectRoot(startPath);

    if (!root || !name || !parentProjectRoot) {
        return null;
    }

    return {
        name,
        root,
        parentProjectRoot,
    };
}

/**
 * Detect current execution context - standardized across codebase
 * @param startPath Starting directory path (defaults to process.cwd())
 * @returns Execution context
 */
export function getExecutionContext(startPath: string = process.cwd()): ExecutionContext {
    // Check for worktree context first (most specific)
    if (isInWorktree(startPath)) {
        return 'worktree';
    }

    if (getForcedProjectRoot()) {
        return 'dexto-project';
    }

    // Check for Dexto source context
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
