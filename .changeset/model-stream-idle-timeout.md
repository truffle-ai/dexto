---
'@dexto/core': patch
---

A model stream that sends nothing for 5 minutes no longer holds the turn. Before any output the attempt is retried like a transient provider error; after output the turn fails with `llm_stream_stalled`. The `llm.stream` span now records `llm.stream.max_event_gap_ms`.
