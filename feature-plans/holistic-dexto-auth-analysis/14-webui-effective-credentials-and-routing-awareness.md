# WebUI Provider Credentials (Explicit Provider Gating)

## Why this doc exists

With explicit providers, key gating should be straightforward and predictable:
- selecting `dexto` should only require `DEXTO_API_KEY`
- selecting `openrouter` should only require `OPENROUTER_API_KEY`
- selecting a direct provider should require that provider’s auth

## Desired behavior

1. `/llm/catalog` should expose `hasApiKey` per provider based on that provider’s own credential requirements.
2. WebUI should gate selection on that provider’s auth state (not on some inferred routing path).
3. If the picker supports a “Run via …” toggle, the UI should disable toggles whose provider auth is missing.

## Recommended API evolution (for “Run via …”)

Extend `/llm/catalog` (or a new endpoint) to return:
- model groups (displayName + canonicalId)
- per-group backend variants:
  - `{ provider, model, available: boolean }`

This keeps the mapping logic server-side and prevents duplicated, drifting heuristics in the WebUI.
