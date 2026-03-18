---
'@dexto/server': patch
'dexto': patch
'@dexto/tui': patch
---

Add direct cloud-agent chat support to the CLI, including agent selection, shared Ink UI support through a backend adapter layer, and cloud session,
streaming, approval, and cancel flows. Also align cloud behavior with the local CLI for command availability, approval handling, and context clearing.