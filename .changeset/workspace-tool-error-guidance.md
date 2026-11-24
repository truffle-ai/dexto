---
'dexto': patch
---

Workspace-tool errors now read as CLI errors. A tool's message names the CLI command instead of its `dexto_*` tool name, validation output is joined into one line that keeps the field (`Invalid Dexto Autobot input: Invalid UUID at autobotId`), and a `get`, `read` or `status` command that finds nothing, or is given an invalid id, suggests its group's `list` command as `fix`. Exit codes are unchanged.
