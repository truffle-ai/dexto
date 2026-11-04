---
'@dexto/core': minor
---

Let a host defer a model tool call's approval. The turn driver now passes `{ deferrable: true }` to the approval handler for a call's own approval, asked before the call runs. The handler may throw `ApprovalDeferredError` instead of answering: `TurnDriver.executeToolCalls()` then returns `{ kind: 'deferred', approvalIds }` after every sibling settles, persists nothing, and leaves the batch unexecuted, so a driver resumed from its checkpoint asks again and replays completed siblings from the tool execution store. `executeToolCalls()` now returns `{ kind: 'executed' }` otherwise; `TurnExecutor.execute()` fails a turn whose approval is deferred.
