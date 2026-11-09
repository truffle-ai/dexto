---
'@dexto/tools-filesystem': patch
'@dexto/image-local': patch
---

Match blocked names regardless of case, so a differently cased name no longer slips past on case-insensitive file systems. `read_file` and `edit_file` check a file's size before reading it when the workspace handle can report one, and the local handle now reports file sizes. `glob_files` checks blocked paths only for the entries it returns, which makes large results much faster. A foreground command that times out or is aborted now also has its whole process group killed when the shell exits first, so a child that ignores SIGTERM and has its output redirected away no longer survives.
