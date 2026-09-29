---
'@dexto/core': patch
---

Let a tool opt in with `resumable: true` to re-enter its own durable execution record when a host retry finds it still `running` with the same identity and input. Every other tool keeps failing with "already running", so an in-flight execution is never run twice by default.
