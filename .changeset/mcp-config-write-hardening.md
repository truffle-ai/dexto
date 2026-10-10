---
'dexto': patch
---

Use private atomic writes for standalone MCP add/remove configuration on POSIX. Successful POSIX edits use mode `0600`, including existing files, and observed leaf symlinks are rejected. Select the actual configuration file when editing; POSIX replacement changes its inode. Windows edits retain existing in-place writes and file ACLs, including their existing partial-write failure limitation. YAML comments and literal credential templates remain preserved.
