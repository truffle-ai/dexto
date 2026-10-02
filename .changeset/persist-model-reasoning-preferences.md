---
'@dexto/tui': minor
'@dexto/agent-management': minor
'@dexto/core': minor
---

Persist per-model reasoning preferences in the CLI. Switching model A -> B -> A now restores A's last explicit reasoning variant and budget override, including after a restart; the same model name on a different provider or endpoint is kept separate. Saved settings are validated against the model's current reasoning profile and reported (not applied) when they no longer fit. `/reasoning` now shows the explicit budget override, the effective budget the request will carry (explicit or provider default), and what is saved for the model. `@dexto/core` exports `buildProviderOptions` and `getEffectiveReasoningBudgetTokens` so hosts can read the effective request options.
