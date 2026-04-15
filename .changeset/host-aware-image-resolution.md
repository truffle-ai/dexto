---
'dexto': patch
'@dexto/agent-config': patch
'@dexto/agent-management': patch
'@dexto/server': patch
---

Add optional host-context plumbing to image and service resolution so hosted runtimes can
adapt resolved services and runtime config without changing the local agent YAML shape.
