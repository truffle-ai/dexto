---
'@dexto/core': minor
---

Let a tool ask the person afresh for every call. `needsApproval` may now return `{ kind: 'always-ask' }`. For that call, auto-approve mode, the allowed-tool lists and remembered approval keys no longer let it run unasked: core records the approval request before the call runs, with `autoApproval: 'disallowed'`, so a host may defer and resume it like any other approval. Approving it remembers nothing, and a remembered approval for a sibling call never settles it while it is pending. Core now reads a local tool's `needsApproval` before checking allowed-tool lists and auto-approve mode, and a tool with a per-call `needsApproval` function is described with `approval: 'possible'` in auto-approve mode.
