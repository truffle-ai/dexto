---
'@dexto/tools-filesystem': patch
---

Close smaller gaps in the file tools. Blocked entries such as `.env` and `.git` now also block the same names in subdirectories. `glob_files` leaves blocked files out of its results, and the glob guard checks every brace expansion of a pattern. `read_file` and `edit_file` enforce `maxFileSize`. `edit_file` previews are limited to files inside the workspace that are not blocked. `edit_file` writes `$` sequences in the replacement text as written.
