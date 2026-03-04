---
'@dexto/image-logger-agent': patch
'@dexto/agent-management': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'@dexto/tui': patch
---

Improve the `/models` picker with curated **Featured**, cross-session **Recents**, and synced **Favorites** sections across TUI/WebUI.

Also improves featured-model selection fairness across providers and prevents stale deleted local models from being selectable.
