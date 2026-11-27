---
'dexto': patch
---

`dexto acp`'s Sign in to Dexto method also carries the older `_meta["terminal-auth"]` command, so ACP apps that don't know `type: terminal` run `dexto login` in a terminal instead of treating sign-in as done.
