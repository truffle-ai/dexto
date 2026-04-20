---
'dexto': patch
'@dexto/core': patch
'@dexto/server': patch
'@dexto/client-sdk': patch
'@dexto/tools-filesystem': patch
'@dexto/tools-todo': patch
---

Tighten session handling across chat and approval flows by removing implicit session creation, dropping global approval fallbacks, requiring real session IDs for session-scoped tool and directory state, and updating session-facing docs to match the current API behavior.
