---
'dexto': patch
'@dexto/agent-management': patch
---

`dexto login` now asks for every read permission the CLI's own commands need, including ones Dexto Cloud does not advertise, such as `artifacts:read`. After a fresh sign-in, `dexto artifacts list` and the other read-only commands work without `--scope`.
