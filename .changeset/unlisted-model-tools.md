---
'@dexto/core': patch
---

A tool can be left out of the model's tool list with `modelListing: 'unlisted'`. The model is not offered it and a model call to it is refused, while a host that reaches it another way (a script or a catalog) still prepares and runs it with its rules and approvals.
