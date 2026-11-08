---
'@dexto/core': patch
---

Load the model history once per turn step instead of five times, and count messages without loading them. A step used to load the full history to prepare each request and again for three length checks, which raised the step's memory in a host that parses the history on every read. The step now loads once, prepares from that load, and loads again only after pruning or compaction changes the stored messages. `ConversationStore` gains an optional `countModelMessages`; a store without it keeps working because core derives the count from `loadModelHistory`. `ContextManager.getModelHistory()` is replaced by `loadModelHistory()`, which returns the same load the store returns.
