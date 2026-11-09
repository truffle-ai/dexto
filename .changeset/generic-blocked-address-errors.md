---
'@dexto/core': patch
'@dexto/tools-builtins': patch
---

The errors for a refused `http_request` target and a refused image download now name only the host that was requested. They no longer print the address a name resolved to or say whether it was a metadata or a private address.
