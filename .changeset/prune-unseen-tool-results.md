---
'@dexto/core': patch
---

Stop long runs from looping on pruned tool output. Pruning no longer clears tool results the model has not seen yet, and the protected tool-output budget now scales with the model's input window (the larger of 40k tokens or 30% of the window). A new `context:pruned-tool-call-repeated` event reports when the model repeats a call whose earlier result was pruned, so hosts can surface and alert on runs that stop making progress.
