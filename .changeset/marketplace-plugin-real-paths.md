---
'@dexto/agent-management': patch
---

Check the real path of every marketplace plugin directory (manifest entries, `plugins/`, `external_plugins/` and root-level directories), fail closed when a path cannot be resolved, and install from the checked real path.
