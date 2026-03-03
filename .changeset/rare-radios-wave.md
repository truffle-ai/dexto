---
'dexto': patch
---

Reduce CLI startup overhead by lazily loading command/runtime modules and deferring analytics/version-check setup until commands execute.

In local measurements (`/usr/bin/time -l`, with analytics/version checks disabled), this improved startup/resource usage versus the original baseline by approximately:
- `dexto --help`: 27.5% faster, 21.8% lower RSS
- `dexto --version`: 36.9% faster, 22.8% lower RSS
- `dexto session list` (minimal no-MCP agent): 16.2% faster, 17.4% lower RSS
