---
'dexto': patch
'@dexto/core': patch
'@dexto/storage': patch
---

`npm install dexto` and the dexto.ai installer work without a compiler or Python on Node.js 20, 22, 24 and 26. better-sqlite3 12.9 ships prebuilt binaries for Node.js 20, 22 and 24, and is now optional for the CLI: where it cannot install, as on Node.js 26, `@dexto/storage` opens SQLite with the `node:sqlite` built into Node.js instead. `openSqlite` is exported for other SQLite readers.
