---
'dexto': patch
'@dexto/cloud-client': patch
---

Add `dexto cloud environments` (`list`, `get`, `create`, `update`, `rebuild`, `builds list`, `builds get`) to manage Environments and their builds from the CLI, ported from the cli-2.0 line (DEXTO-3200). The `/v1` client types now include the Environment routes.
