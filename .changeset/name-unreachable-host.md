---
'dexto': patch
---

When Dexto can't be reached, cloud commands now name the host and the reason instead of printing only "fetch failed", for example `Couldn't reach http://127.0.0.1:59999 (connection refused).`, with what to check (your network, or `--api-base-url` / `DEXTO_API_BASE_URL`). The exit code stays 1.
