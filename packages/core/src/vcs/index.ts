/**
 * VCS (Version Control System) module exports
 * Provides git worktree operations for Dexto
 */

// Error codes
export { VCErrorCode } from './error-codes.js';

// Error factory
export { VCSError } from './errors.js';

// Worktree operations
export {
    isGitAvailable,
    isGitRepo,
    getWorktreesDirPath,
    getWorktreePath,
    worktreeExists,
    createWorktree,
    listWorktrees,
    removeWorktree,
    pruneWorktrees,
    type WorktreeContext,
} from './worktree.js';
