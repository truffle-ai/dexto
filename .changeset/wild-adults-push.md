---
"dexto": patch
---

Add a new headless `dexto run <prompt>` command for one-off, non-interactive tasks.

`dexto run` defaults to non-interactive execution (auto-approve + no elicitation), prints a compact run transcript to `stderr` (including tool/MCP lifecycle updates), and writes only the final assistant response to `stdout` for piping and automation.
