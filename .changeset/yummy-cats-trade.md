---
'@dexto/tools-filesystem': patch
'@dexto/server': patch
'@dexto/core': patch
'dexto': patch
---

File integrity & performance improvements, approval system fixes, and developer experience enhancements

### File System Improvements
- **File integrity protection**: Store file hashes to prevent edits from corrupting files when content changes between operations (resolves #516)
- **Performance optimization**: Disable backups and remove redundant reads, switch to async non-blocking reads for faster file writes

### Approval System Fixes
- **Coding agent auto-approve**: Fix auto-approve not working due to incorrect tool names in auto-approve policies
- **Parallel tool calls**: Fix multiple parallel same-tool calls requiring redundant approvals - now checks all waiting approvals and resolves ones affected by newly approved commands
- **Refactored CLI approval handler**: Decoupled approval handler pattern from server for better separation of concerns

### Shell & Scripting Fixes
- **Bash mode aliases**: Fix bash mode not honoring zsh aliases
- **Script improvements**: Miscellaneous script improvements for better developer experience
