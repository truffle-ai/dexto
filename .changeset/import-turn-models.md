---
'dexto': patch
---

`dexto import` and `dexto chat import` now send the model that answered each imported turn (and Codex's reasoning effort), read from Codex `turn_context` lines and Claude Code's `message.model`. When the server says which Dexto model an imported chat continues on, `dexto import` shows it per session, and prints a hint to run `dexto connect codex` when a Codex chat can't continue on its own model (in `--json`, as `hints`). Re-running an import on a session imported before fills in its models. Needs a Dexto Cloud server that accepts the per-message `model` and `reasoningEffort` fields.
