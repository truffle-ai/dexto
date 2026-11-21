---
'dexto': patch
---

`dexto chat import --from claude-code|codex` with no session ids and no `--all` now asks a person at a terminal which chats to bring: all of them, only this folder's, those since a date, or ones picked by number. It then shows the dry-run summary and asks before sending. Without a terminal, or with `--json` or `--yes`, it still asks nothing and exits 2, naming `--all`, `--folder` and `--since`.
