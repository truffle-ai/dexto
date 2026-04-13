/**
 * Git worktree operations for Dexto
 * Provides utilities for creating and managing git worktrees
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { VCSError } from './errors.js';
import type { DextoRuntimeError } from '../errors/index.js';

const execFileAsync = promisify(execFile);

/**
 * Worktree context containing path information
 */
export interface WorktreeContext {
    /** Name of the worktree */
    name: string;
    /** Absolute path to the worktree directory */
    root: string;
    /** Absolute path to the parent project root */
    parentProjectRoot: string;
}

/**
 * Check if git executable is available
 * @returns true if git is available, false otherwise
 */
export async function isGitAvailable(): Promise<boolean> {
    try {
        await execFileAsync('git', ['--version']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a directory is inside a git repository
 * @param dirPath Directory to check
 * @returns true if inside a git repository
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
    try {
        await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: dirPath,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the worktrees base directory path relative to project root
 * @param _projectPath Project root path (unused, for API consistency)
 * @returns Relative path to worktrees directory
 */
export function getWorktreesDirPath(_projectPath?: string): string {
    return '.dexto/worktree';
}

/**
 * Get the absolute path to a worktree directory
 * @param projectPath Project root directory
 * @param name Worktree name
 * @returns Absolute path to the worktree
 */
export function getWorktreePath(projectPath: string, name: string): string {
    return path.join(projectPath, '.dexto', 'worktree', name);
}

/**
 * Check if a worktree already exists
 * @param projectPath Project root directory
 * @param name Worktree name
 * @returns true if worktree exists
 */
export function worktreeExists(projectPath: string, name: string): boolean {
    const worktreePath = getWorktreePath(projectPath, name);
    return existsSync(worktreePath);
}

/**
 * Create a new git worktree with a branch named worktree-<name>
 *
 * @param projectPath Project root directory (must be git repo)
 * @param name Worktree name
 * @param options Additional options
 * @param options.remote Remote to fetch/create branch from (default: origin)
 * @returns Absolute path to the created worktree
 */
export async function createWorktree(
    projectPath: string,
    name: string,
    options: { remote?: string } = {}
): Promise<string> {
    // Validate git is available
    const gitAvailable = await isGitAvailable();
    if (!gitAvailable) {
        throw VCSError.gitNotAvailable();
    }

    // Validate project path is a git repo
    const isRepo = await isGitRepo(projectPath);
    if (!isRepo) {
        throw VCSError.notGitRepo(projectPath);
    }

    // Build branch name
    const branchName = `worktree-${name}`;

    // Ensure worktree parent directory exists
    const worktreesDir = path.join(projectPath, '.dexto', 'worktree');
    if (!existsSync(worktreesDir)) {
        mkdirSync(worktreesDir, { recursive: true });
    }

    // Get worktree destination path
    const worktreePath = getWorktreePath(projectPath, name);

    // Check if worktree already exists
    if (worktreeExists(projectPath, name)) {
        throw VCSError.worktreeExists(name, worktreePath);
    }

    const remote = options.remote || 'origin';

    // Step 1: Try to fetch the branch if it exists remotely
    try {
        await execFileAsync(
            'git',
            ['fetch', remote, `worktree-${name}:refs/heads/worktree-${name}`],
            {
                cwd: projectPath,
            }
        );
    } catch {
        // Branch doesn't exist remotely - that's okay, we'll create it
    }

    // Step 2: Create the worktree
    // Use --no-track to avoid setting upstream (we don't care about tracking)
    // Use -b to create a new branch with the specified name
    try {
        await execFileAsync(
            'git',
            ['worktree', 'add', '--no-track', '-b', branchName, worktreePath],
            {
                cwd: projectPath,
            }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw VCSError.worktreeCreateFailed(name, message, {
            projectPath,
            branchName,
            worktreePath,
        });
    }

    return worktreePath;
}

/**
 * List all worktrees for the repository
 * @param projectPath Project root directory
 * @returns Array of worktree information
 */
export async function listWorktrees(
    projectPath: string
): Promise<Array<{ path: string; branch: string; head: string }>> {
    try {
        const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
            cwd: projectPath,
        });

        const worktrees: Array<{ path: string; branch: string; head: string }> = [];
        const lines = stdout.split('\n');
        let current: { path: string; branch: string; head: string } | null = null;

        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                if (current) {
                    worktrees.push(current);
                }
                current = {
                    path: line.substring(9).trim(),
                    branch: '',
                    head: '',
                };
            } else if (current && line.startsWith('branch ')) {
                current.branch = line.substring(8).trim();
            } else if (current && line.startsWith('HEAD ')) {
                current.head = line.substring(5).trim();
            }
        }

        if (current) {
            worktrees.push(current);
        }

        return worktrees;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw VCSError.worktreeOperationFailed('list', message);
    }
}

/**
 * Remove a worktree
 * @param projectPath Project root directory
 * @param name Worktree name
 * @param options Options for removal
 * @param options.force Force removal even if dirty
 */
export async function removeWorktree(
    projectPath: string,
    name: string,
    options: { force?: boolean } = {}
): Promise<void> {
    const worktreePath = getWorktreePath(projectPath, name);

    if (!worktreeExists(projectPath, name)) {
        throw VCSError.worktreeNotFound(name);
    }

    const args = ['worktree', 'remove', worktreePath];
    if (options.force) {
        args.push('--force');
    }

    try {
        await execFileAsync('git', args, { cwd: projectPath });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw VCSError.worktreeOperationFailed('remove', message, { name, worktreePath });
    }
}

/**
 * Prune stale worktree references
 * @param projectPath Project root directory
 */
export async function pruneWorktrees(projectPath: string): Promise<void> {
    try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw VCSError.worktreeOperationFailed('prune', message);
    }
}
