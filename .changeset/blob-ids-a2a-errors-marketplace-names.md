---
'@dexto/storage': patch
'@dexto/server': patch
'@dexto/agent-management': patch
---

Accept only well-formed blob ids (16 hex characters, with or without the `blob:` prefix) in the local and in-memory blob stores. A2A JSON-RPC no longer returns internal error messages to callers: unexpected failures answer with a generic "Internal error", while missing or unknown parameters keep their message and now use the JSON-RPC invalid-params code. `dexto plugin marketplace add` now rejects a `--name` (or a name derived from the source) that is not a safe single path segment.
