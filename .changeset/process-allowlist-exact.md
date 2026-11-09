---
'@dexto/tools-process': minor
---

`allowedCommands` now matches the whole command exactly instead of by prefix, so an allowed command can no longer be extended with extra shell commands.

Config change needed: each entry must be the full command string you want to allow, for example `git status` or `npm test`. An entry that used to allow many commands by prefix (such as `git` to allow `git status` and `git log`) now allows only the exact command `git`; list each full command you rely on. An empty list is unchanged (any command, subject to approval).
