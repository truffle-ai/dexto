---
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

- Replace the hardcoded LLM registry with a `models.dev`-synced snapshot, manual overlays, and a Node-only cached auto-update path.
- Enforce gateway providers (e.g. `dexto`, `openrouter`) use OpenRouter-format model IDs (`vendor/model`) and improve model capability filtering.
- Improve model selection UX in CLI and Web UI (curated lists by default, clearer post-setup path for custom model IDs).
- Tighten server LLM route query validation and keep OpenAPI docs in sync.
