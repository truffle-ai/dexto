---
'dexto': patch
---

Reduce CLI startup overhead by lazily loading command handlers and runtime modules, and deferring analytics/version-check initialization until commands execute. This lowers memory footprint and improves startup performance for lightweight commands like `--help` and `--version`.
