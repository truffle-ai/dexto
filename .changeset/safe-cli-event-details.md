---
'dexto': patch
'@dexto/agent-management': patch
---

Avoid sending agent names and error messages in CLI analytics. Show the path of a forbidden configuration key when loading an agent config; keys named `constructor` or `prototype` are rejected even in custom config maps.
