---
"@dexto/core": patch
---

Log a tool's own failure (invalid arguments, or a throw from the tool or its MCP server) at warn instead of error, with the tool name, error code and session id as attributes rather than in the message. Failures in core's own handling (hooks, the execution store) stay at error. Drop the duplicate `Local tool execution failed` log and the `withSpan` error log for synchronous methods, which now leave logging to the caller as the async path already did.
