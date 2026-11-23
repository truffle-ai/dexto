---
'dexto': patch
---

`dexto chat agents` lists the agent profiles you can chat with, for `dexto chat start --agent`, from the Dexto MCP's `dexto_agents_list`. `--limit` takes 1 to 50 (default 20) and `--json` prints the tool's result; a sign-in without `agents:read` is asked to sign in again with it (DEXTO-3481).
