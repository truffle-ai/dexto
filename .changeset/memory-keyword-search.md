---
'@dexto/core': patch
'@dexto/server': patch
'@dexto/tools-lifecycle': patch
---

Add keyword search to memory listing. `MemoryManager.list()` accepts a `query` option that matches memory content and tags case-insensitively, requiring every whitespace-separated term to match. The option is exposed through the `memory_list` tool and the `GET /memory` endpoint.
