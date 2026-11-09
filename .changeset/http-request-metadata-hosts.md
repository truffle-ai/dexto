---
'@dexto/core': patch
'@dexto/tools-builtins': patch
---

`http_request` and the AI SDK image and file downloader now refuse cloud metadata host names (such as `metadata.google.internal`) by name, using the shared `isMetadataHost` check, before any DNS lookup or connection.
