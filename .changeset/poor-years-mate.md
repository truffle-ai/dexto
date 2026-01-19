---
'@dexto/agent-management': patch
'@dexto/tools-filesystem': patch
'@dexto/tools-process': patch
'@dexto/core': patch
'dexto': patch
---

- new --dev flag for using dev mode with the CLI (for maintainers) (sets DEXTO_DEV_MODE=true and ensures local files are used)
- improved bash tool descriptions
- fixed explore agent task description getting truncated
- fixed some alignment issues
- fix search/find tools not asking approval for working outside directory
- add sound feature (sounds when approval reqd, when loop done)
  - configurable in `preferences.yml` (on by default) and in `~/.dexto/sounds`, instructions in comment in `~/.dexto/preferences.yml`
- add new `env` system prompt contributor that includes info about os, working directory, git status. useful for coding agent to get enough context to improve cmd construction without unnecessary directory shifts
- support for loading `.claude/commands` and `.cursor/commands` global and local commands in addition to `.dexto/commands`
