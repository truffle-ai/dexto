---
'dexto': patch
---

Keep MCP OAuth sign-in working when an old name-keyed credential file cannot be deleted (for example a root-owned file left by an earlier `sudo` run). The CLI now logs a warning naming the file and carries on instead of failing every sign-in.
