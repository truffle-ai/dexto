---
'@dexto/core': patch
---

Name the check that lets a tool call run without asking: the approval gate's ready result and each ready prepared call now carry `because` (`session-allowed`, `always-allow`, `allowed-tools`, `auto-approve-mode`, `tool-allows` or `session-approved-key`), and the turn executor records it on the `tool.prepare` span as `tool.approval_gate`.
