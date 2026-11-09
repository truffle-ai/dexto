---
'@dexto/core': patch
'@dexto/image-local': patch
'@dexto/tools-process': patch
---

Make foreground `bash_exec` through the workspace handle honour its timeout and the abort signal, stopping the command and everything it started. A non-zero exit is returned as a result instead of thrown. Background commands are now stopped as a process group, so their child processes stop too. `WorkspaceProcesses.exec` accepts an optional `signal` and may report `timedOut`.
