---
'@dexto/image-logger-agent': patch
'@dexto/agent-management': patch
'@dexto/analytics': patch
'@dexto/core': patch
'dexto': patch
'@dexto/tui': patch
---

Replace `DEXTO_DEV_MODE` with `DEXTO_HOME_DIR` and simplify how Dexto resolves home-backed paths in local development and normal CLI usage.

- Use `DEXTO_HOME_DIR` as the single override for Dexto-managed storage, credentials, and other home-backed files.
- Keep source-context defaults pointed at the repository (`<repo>/.dexto` and `<repo>/.env`) without a separate dev-mode branch.
- Route env/config/auth/model/cache/sound/image path resolution through shared helpers instead of hardcoded `~/.dexto` joins.
- Remove legacy path fallbacks and old compatibility branches around path and skill resolution.
- Update development docs and tests to reflect the new path behavior.
