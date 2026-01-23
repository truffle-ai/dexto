# Where Should Backend Selection Live? (Agent Config vs Preferences)

With explicit providers, “backend selection” is simply `llm.provider` + `llm.model`.

## Recommendation

### Put backend selection in agent config; use preferences only for UI defaults

**Agent config (`agents/*/*.yml`, installed agents under `~/.dexto/agents/`)**
- Source of truth for what a deployed agent will execute.
- Required for dexto-cloud portability (no reliance on local user state).

**Global preferences (`~/.dexto/preferences.yml`)**
- Good for “what should the setup wizard pick by default?”
- Good for “what should the model picker default to when multiple backends are available?”
- Should not override an agent’s configured provider/model at runtime.

## What should NOT live in agent config

- Secrets (Dexto API keys, provider API keys). Continue to use env vars / secret injection.
- Ephemeral auth state (OAuth refresh tokens, session cookies) — belongs in the auth store.
