---
'@dexto/core': patch
---

Telemetry spans no longer turn whole objects into text. A traced method's result or argument that is a class instance (a session, a service, a client) is recorded as `[ClassName]` without being read; a `Date` is recorded as its time and an `Error` as its name and message, and a value that cannot be read (a revoked Proxy) as `[Unserializable value]` without failing the call. With a `maxLen`, `safeStringify` now stops reading a value once it has about that length: it reads each array item, Map entry and object key only while that budget is left (enumerating a plain object's keys still takes time proportional to how many it has), reads a string only up to the budget plus 1,024 characters, and writes an object it reaches again as `[Shared]`. A string is never cut inside a run of token characters, so a JWT or key that runs across the cut is redacted whole (a run over 64 KB is left out from its start). Without a `maxLen`, the output is unchanged. Before, `createSession` and `getSession` encoded the whole `ChatSession` graph (often tens of MB) on every call, only to keep its first 8,192 characters.

A replayed tool call whose execution record failed with an empty error now says `Tool execution already failed: <id>`, without a trailing colon.
