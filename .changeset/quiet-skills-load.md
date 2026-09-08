---
'@dexto/core': minor
'@dexto/agent-config': minor
'@dexto/agent-management': minor
'@dexto/image-local': minor
'@dexto/tools-builtins': minor
'@dexto/server': minor
'@dexto/tui': minor
dexto: minor
---

Replace source-composed Skills with one injected exact-name `Skills` implementation and the
`skill_load` tool contract. Local skills use the canonical `.agents/skills` roots, while hosted
storage and resolution remain owned by the host image. This is an intentional forward-rolling
migration: Cloud consumers will take the exact tested Core artifact/version before their dependent
changes merge, so the removed source-composed APIs are not retained as compatibility exports.
