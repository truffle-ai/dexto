---
'@dexto/server': patch
'@dexto/core': patch
'dexto': patch
'@dexto/tui': patch
---

Add session forking with visible lineage across core, API, and CLI UX:

- Add `forkSession(parentSessionId)` in core and expose `POST /api/sessions/:sessionId/fork`.
- Persist child lineage via `parentSessionId` and clone persisted message history.
- Generate forked session titles as `Fork: ...` (from parent title or parent ID fallback).
- Surface fork lineage in `/resume` and `dexto session list`, and add a new interactive `/fork` command.
