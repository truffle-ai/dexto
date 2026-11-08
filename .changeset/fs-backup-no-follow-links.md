---
'@dexto/tools-filesystem': patch
---

Filesystem backups no longer follow symlinks. A file that is a symlink is refused instead of copying its target, and a backup never writes through a link already at the backup path.
