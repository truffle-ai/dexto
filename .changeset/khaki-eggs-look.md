---
'@dexto/core': patch
'dexto': patch
'@dexto/tui': patch
---

Add `--worktree` flag for creating and managing multiple workspaces via git worktrees.

Users can now create isolated worktrees with dedicated branches for different tasks, and Dexto will automatically detect when it's running inside a worktree and resolve to the correct project root.