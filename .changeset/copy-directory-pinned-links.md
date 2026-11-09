---
'@dexto/agent-management': patch
---

Copy plugin and agent folders without following links that are swapped in while the copy runs. Every directory and file is now opened and checked before it is read, and the copy stops with an error if anything it was reading is replaced by a link to somewhere else.
