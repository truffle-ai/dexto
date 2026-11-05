---
'dexto': minor
'@dexto/agent-management': minor
'@dexto/cloud-client': minor
---

A signed-in person's Dexto Skills library joins local skill discovery:

- `dexto`: each session syncs the library into `~/.dexto/cloud-skills` (only Skills whose files changed download; Skills that left the library are removed; offline keeps the last copy with one warning; with no person signed in the copy is removed). `dexto skills sync` syncs on demand. `--api-key -` reads the key from stdin, and `--api-key` with no value asks for it. The coding agent ships an `import-chats` skill for `dexto chat local` and `dexto chat import`.
- `@dexto/agent-management`: `~/.dexto/cloud-skills` is the last standalone skill root, with source `cloud`, so a local Skill of the same name wins. `getStandaloneSkillPaths` is exported.
- `@dexto/cloud-client`: `GET /v1/skills` and `GET /v1/skills/{skill_id}/bundle`.
