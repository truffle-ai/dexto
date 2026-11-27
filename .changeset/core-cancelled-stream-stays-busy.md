---
'@dexto/core': patch
---

Keep a session busy until a cancelled stream unwinds, so a newer run never receives its late `run:complete` or loses its own completion to it.
