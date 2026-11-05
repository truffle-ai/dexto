---
'dexto': patch
'@dexto/core': patch
'@dexto/agent-management': patch
---

`dexto run` reports a failure once: in `--json` and `--stream-json`, stdout carries only JSON and stderr only the JSON error, and in text mode the error prints once with the command that fixes it. A run with no provider key and no Dexto sign-in exits 3 (needs sign-in) and points to `dexto login`; `--model` without that provider's key also exits 3. Logs go to stderr, so the first use of a bundled agent no longer prints install lines before the JSON. An unknown command exits 2 and points to `dexto --help` instead of trying to start the chat. Text mode no longer echoes the reply on stderr.
