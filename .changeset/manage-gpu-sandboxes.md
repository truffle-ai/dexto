---
'dexto': patch
'@dexto/agent-management': patch
---

`dexto gpus provision|start|stop|delete` and `dexto gpus process start|stop` provision, start, stop and delete your Dexto-managed GPU sandboxes and start or stop processes in them, with `--json`, `--dry-run` and `--yes`. They need the `gpu:write` permission, which the CLI can now ask for at sign-in.
