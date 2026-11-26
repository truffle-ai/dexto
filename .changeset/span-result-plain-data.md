---
'@dexto/core': patch
---

Telemetry spans no longer turn whole objects into text. A traced method's result or argument that is a class instance (a session, a service, a client) is recorded as `[ClassName]` without being read, and `safeStringify` now stops reading a value once it has about the requested length, writing an object it reaches again as `[Shared]`. Before, `createSession` and `getSession` encoded the whole `ChatSession` graph (often tens of MB) on every call, only to keep its first 8,192 characters.

A replayed tool call whose execution record failed with an empty error now says `Tool execution already failed: <id>`, without a trailing colon.
