---
'@dexto/core': patch
---

Drop persisted queued follow-up state on startup and best-effort shutdown so stale interrupted messages do not survive an agent restart.
