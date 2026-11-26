---
'@dexto/core': patch
---

A tool call replayed onto an execution record that already failed now says why it failed, using the error stored on the record, instead of only `Tool execution already failed: <id>`. A host that fails a row an interrupted try left running (its effects unknown) can tell the model that.
