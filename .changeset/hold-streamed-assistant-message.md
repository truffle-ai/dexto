---
'@dexto/core': patch
---

Stop reading the whole stored history for every streamed text delta. `ContextManager` used to call `listMessages` to find the assistant message for each `appendAssistantText`, `addToolCall` and `updateAssistantMessage`, so a streamed reply of 200 deltas read and parsed the full history about 200 times in a host that parses it on every read (about 2.7 GB for a 13 MB history). The manager now holds the reply's assistant message for the model step and writes it through with `updateMessage` as before: the same stored messages and the same events. The held message is dropped when the step ends (`StreamProcessor.process` calls the new `ContextManager.releaseAssistantMessage()`), on any other write through the manager, and after a failed write, so a host's own write between steps is read again and never overwritten. An id the manager did not start is found with one read, then held. No `ConversationStore` change: stores must copy a message on save and on `updateMessage`, which the in-memory, database and cloud stores do.

Called outside a step, `appendAssistantText`, `addToolCall` and `updateAssistantMessage` hold the message until the next `releaseAssistantMessage()` or manager write.
