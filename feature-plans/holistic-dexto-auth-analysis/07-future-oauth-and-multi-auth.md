# Future OAuth + Multi-Auth (Design Notes)

Long term, “how to pay” may include multiple credential types:
- Dexto Credits (Dexto API key)
- Direct provider keys (BYOK)
- Subscription OAuth (ChatGPT Plus/Claude Pro, etc.)

Key principle:
- Keep *selection* (provider/model) separate from *credential sources* and *routing policy*.

## Suggested mental model

1. Semantic selection:
   - `provider` + `model`
2. Available credentials:
   - One or more credential sources, each with a scope (global/user, per-agent, per-model)
3. Routing policy:
   - Which credential to prefer, plus fallback behavior

## Why this matters now

If we bake “dexto” as a provider into user configs, OAuth and BYOK flows get harder:
- Every auth method becomes a “provider” rather than a credential source.
- Switching methods requires rewriting provider/model identifiers.

Keeping Dexto as infrastructure avoids that trap.

## Open questions to resolve later

- Do we want per-agent routing policies (platform-friendly) in addition to global preferences?
- How do we represent subscription OAuth in a way that is portable but secure?
- How do we expose “available credentials” to the WebUI without leaking secrets?

