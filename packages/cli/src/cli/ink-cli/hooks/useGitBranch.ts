/**
 * useGitBranch Hook
 *
 * Detects the current git branch name for the working directory.
 * Returns undefined if not in a git repository or if git command fails.
 */

import { useState, useEffect } from 'react';
import { execSync } from 'child_process';

/**
 * Hook that returns the current git branch name
 * @param cwd - Working directory to check (defaults to process.cwd())
 * @returns Branch name string or undefined if not in git repo or command fails
 */
export function useGitBranch(cwd?: string): string | undefined {
    const [branchName, setBranchName] = useState<string | undefined>(undefined);

    useEffect(() => {
        const workingDir = cwd || process.cwd();

        try {
            // Get current branch name using git rev-parse --abbrev-ref HEAD
            // This is faster and more reliable than parsing git branch output
            const result = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: workingDir,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const branch = result.trim();
            setBranchName(branch || undefined);
        } catch {
            // Not in a git repo, git not installed, or command failed
            setBranchName(undefined);
        }
    }, [cwd]);

    return branchName;
}
