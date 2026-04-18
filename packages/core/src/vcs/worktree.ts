/**
 * Git worktree operations for Dexto
 * Provides utilities for creating and managing git worktrees
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { VCSError } from './errors.js';

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
 * Get the root directory of a git repository
 * @param dirPath Directory within the git repository
 * @returns Absolute path to the git repository root
 */
export async function getGitRoot(dirPath: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dirPath,
    });
    return stdout.trim();
}

/**
 * Check if a git repository has unstaged changes
 * @param dirPath Directory within the git repository
 * @returns true if there are unstaged changes
 */
export async function hasUnstagedChanges(dirPath: string): Promise<boolean> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: dirPath,
    });
    // Filter out staged changes (lines starting with space), keep unstaged (lines starting with [MDARC?])
    const lines = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '');
    return lines.some((line) => line[0] !== ' ' && line[0] !== '');
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
    // Validate worktree name to prevent path traversal
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        throw VCSError.invalidWorktreeName(name);
    }
    return path.join(projectPath, '.dexto', 'worktree', name);
}

/**
 * Check if a worktree name is valid (no path traversal or suspicious patterns)
 * @param name Worktree name to validate
 * @returns true if valid, false otherwise
 */
export function isValidWorktreeName(name: string): boolean {
    return /^[a-zA-Z0-9._-]+$/.test(name);
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

    // Step 2: Check if branch already exists locally
    let branchExistsLocally = false;
    try {
        await execFileAsync(
            'git',
            ['rev-parse', '--verify', `--quiet`, `refs/heads/${branchName}`],
            {
                cwd: projectPath,
            }
        );
        branchExistsLocally = true;
    } catch {
        branchExistsLocally = false;
    }

    // Step 3: Create the worktree
    // Use --no-track to avoid setting upstream (we don't care about tracking)
    // Use -b only if branch doesn't exist locally (otherwise git will fail)
    try {
        const args = ['worktree', 'add', '--no-track'];
        if (!branchExistsLocally) {
            // Creating new branch: -b creates it from HEAD automatically
            args.push('-b', branchName, worktreePath);
        } else {
            // Branch exists locally, use it directly (without -b)
            args.push(worktreePath, branchName);
        }

        await execFileAsync('git', args, {
            cwd: projectPath,
        });
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
 * Remove a worktree
 * @param projectPath Project root directory
 * @param name Worktree name
 * @param options Options for removal
 * @param options.force Force removal even if dirty
 * @param options.deleteBranch Also delete the associated branch
 */
export async function removeWorktree(
    projectPath: string,
    name: string,
    options: { force?: boolean; deleteBranch?: boolean } = {}
): Promise<void> {
    const worktreePath = getWorktreePath(projectPath, name);

    if (!worktreeExists(projectPath, name)) {
        throw VCSError.worktreeNotFound(name);
    }

    const args = ['worktree', 'remove'];
    if (options.force) {
        args.push('--force');
    }
    args.push(worktreePath);

    try {
        await execFileAsync('git', args, { cwd: projectPath });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw VCSError.worktreeOperationFailed('remove', message, { name, worktreePath });
    }

    // Delete the associated branch if requested
    if (options.deleteBranch) {
        const branchName = `worktree-${name}`;
        try {
            await execFileAsync('git', ['branch', '-D', branchName], { cwd: projectPath });
        } catch (error) {
            // Branch might not exist - that's okay
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('not found') && !message.includes('does not exist')) {
                throw VCSError.gitBranchFailed('delete', branchName, message);
            }
        }
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
