---
'dexto': patch
---

A command's whole output now reaches a pipe before the CLI exits, so a large `--json` result such as `dexto workspace tools --json | jq` is no longer cut off (DEXTO-3501). The CLI waits for stdout and stderr to flush before it exits.
