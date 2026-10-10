---
'dexto': patch
---

Replace standalone MCP add/remove configuration through private atomic writes. Successful POSIX edits use mode `0600`, including existing files, and observed leaf symlinks are rejected. Select the actual configuration file when editing; replacement changes its inode. YAML comments and literal credential templates remain preserved.
