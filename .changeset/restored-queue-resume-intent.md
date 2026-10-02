---
"@dexto/core": patch
"@dexto/tui": patch
"dexto": patch
---

Queued steer/follow-up input that survives an interrupted run is now held on reopen instead of running with the next unrelated message. Core exposes `getRestoredPendingInput`, `takeRestoredPendingInput` (resume, exactly once) and `discardRestoredPendingInput`; the TUI shows the on-hold input when a session opens and adds `/queue`, `/queue resume`, `/queue discard`.
