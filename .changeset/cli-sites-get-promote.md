---
'dexto': patch
---

`dexto cloud sites get <site-id>` shows a Site you reach with its newest deployments, and `dexto cloud sites promote <site-id> <deployment-id>` makes a ready deployment its live production release, asking first or taking `--yes` (DEXTO-3485). Both use the Dexto MCP's existing `dexto_site_get` and `dexto_site_promote` operations and print JSON with `--json`.
