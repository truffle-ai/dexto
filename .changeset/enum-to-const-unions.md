---
"@dexto/core": patch
"@dexto/agent-management": patch
"@dexto/server": patch
"@dexto/tools-filesystem": patch
"@dexto/tools-process": patch
"@dexto/tools-scheduler": patch
"@dexto/tools-todo": patch
---

refactor: replace enums with const-list-derived unions

Replaces 27 TypeScript enums with const-list-derived unions following the pattern from PR #686. Each enum is converted to an `as const` array as the single source of truth, with a derived union type and named-key object for dot-access compatibility.
