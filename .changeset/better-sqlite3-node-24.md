---
'dexto': patch
'@dexto/core': patch
'@dexto/storage': patch
---

Use better-sqlite3 12, which ships prebuilt binaries for Node.js 24, so `npm install dexto` and the dexto.ai installer work on Node 24 without a compiler and Python.
