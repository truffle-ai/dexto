---
'@dexto/agent-management': patch
---

Keep skills and plugin copies from following links out of their directory. A `SKILL.md` that links outside its skill directory is no longer listed or loaded. `skill_create` and `skill_update` refuse to write through a linked `SKILL.md` or a skill directory that resolves outside the skills root. Directory copies, including plugin installs, skip links that point outside the source.
