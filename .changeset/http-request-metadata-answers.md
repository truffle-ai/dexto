---
'@dexto/core': patch
'@dexto/tools-builtins': patch
---

`http_request` and the AI SDK image and file downloader now also refuse a host name whose DNS answer is a cloud metadata address, such as the Azure WireServer address 168.63.129.16, which is not in a private range.
