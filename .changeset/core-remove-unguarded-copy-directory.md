---
'@dexto/core': minor
---

Remove the unused `copyDirectory` helper from `@dexto/core`. It copied through symlinks without any check. `@dexto/agent-management` has its own guarded `copyDirectory`; use that instead.
