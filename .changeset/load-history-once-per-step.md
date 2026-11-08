---
'@dexto/core': patch
---

Load the model history once per turn step instead of five times, and count messages without loading them. A step used to load the full history to prepare each request and again for three length checks, which meant extra reads and parses per step in a host that parses the history on every read. The step now loads once, prepares from that load, and loads again only after pruning or compaction changes the stored messages. `ConversationStore` gains an optional `countModelMessages`; a store without it keeps working because core derives the count from `loadModelHistory`. `ContextManager` gains `loadModelHistory()`, which returns the same load the store returns; `getModelHistory()` stays as a deprecated alias for its messages.
