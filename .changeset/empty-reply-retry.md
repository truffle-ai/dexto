---
'@dexto/core': patch
'@dexto/server': patch
'@dexto/tui': patch
'@dexto/webui': patch
---

Retry a model step once when the reply ends with finish reason "other" and no text, tool calls or usage. If the retry is also empty, fail with "The model ended its reply without answering. Try again." `llm:retrying` now has a `reason` (`transient_error` or `empty_response`) and is sent on session event streams too. The Web UI and TUI drop the reasoning an empty reply streamed so it is not shown twice.
