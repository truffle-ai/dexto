/**
 * VCS error codes for git operations
 */
export enum VCErrorCode {
    // Worktree operations
    WORKTREE_CREATE_FAILED = 'vcs_worktree_create_failed',
    WORKTREE_EXISTS = 'vcs_worktree_exists',
    WORKTREE_NOT_FOUND = 'vcs_worktree_not_found',
    WORKTREE_OPERATION_FAILED = 'vcs_worktree_operation_failed',

    // Git availability
    GIT_NOT_AVAILABLE = 'vcs_git_not_available',
    NOT_GIT_REPO = 'vcs_not_git_repo',

    // Git errors
    GIT_COMMAND_FAILED = 'vcs_git_command_failed',
    GIT_BRANCH_FAILED = 'vcs_git_branch_failed',
}
