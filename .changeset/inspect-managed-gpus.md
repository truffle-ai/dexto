---
'dexto': patch
'@dexto/agent-management': patch
---

`dexto gpus profiles|list|get|process|logs` inspect your Dexto-managed GPU profiles, sandboxes, processes and one bounded page of a process's stdout or stderr, with `--json`. They need the `gpu:read` permission, which the CLI can now ask for at sign-in.
