---
'dexto': patch
'@dexto/core': patch
'@dexto/storage': patch
---

Use better-sqlite3 12.11, which ships prebuilt binaries for Node.js 22, 24 and 26, so `npm install dexto` and the dexto.ai installer work on those versions without a compiler and Python. Node.js 20, which reached end of life in April 2026, has no prebuilt binary in this release: installing there builds SQLite from source and needs Python and a C++ compiler.
