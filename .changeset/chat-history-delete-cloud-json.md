---
'dexto': patch
---

`dexto chat history` and `dexto chat delete` work on cloud chats, take `--json`, and no longer start a local agent or sync Skills for one. `chat history <id>` reads every message of a cloud chat, oldest first; `chat delete <id>` deletes one of your cloud chats and its computer, asking first (`--yes`, `--dry-run`). Add `--local` for a chat on this machine, as with `chat list --local`; `chat delete --local` still deletes its synced copy too. A chat id the chosen side doesn't have fails with `not_found` (exit 5) and the command for the other side. `chat history` now needs a chat id.
