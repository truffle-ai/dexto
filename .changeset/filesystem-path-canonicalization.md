---
"@dexto/tools-filesystem": patch
---

Canonicalize paths that do not exist yet (including dangling symlinks) before applying filesystem policy checks, and write files through a no-follow handle that is re-verified after open.
