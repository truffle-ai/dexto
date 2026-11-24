---
'dexto': patch
---

In a JSON mode (`--json`, `--stream-json`, or stdout not a terminal) the start-up Skills sync no longer writes its "Synced N more" or "Couldn't sync" note to stderr, so a successful command leaves stderr empty.
