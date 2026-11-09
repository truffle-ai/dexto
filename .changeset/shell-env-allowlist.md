---
'@dexto/tools-process': minor
'@dexto/core': minor
---

Shell commands now start with a small environment instead of the full host environment: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TERM` and `TMPDIR` (plus the Windows system variables), and nothing else. Model provider keys and the server key are no longer visible to commands. If a command relied on another inherited variable, add it under `environment` in the `process-tools` config.

Telemetry spans on agent classes no longer record method arguments by default. A class that wants them opts in with `captureArguments: true`.
