---
'@dexto/core': patch
---

Log a failed model call once, at warn, instead of three times at error. The stream callback and the stream processor now log it at debug; the host decides the run's failure level.
