# Future OAuth + Multi-Auth (Design Notes)

Long term, each provider may support multiple auth methods:
- Dexto (`dexto` provider): credits API key, OAuth subscriptions, enterprise auth, …
- Direct providers: API key, OAuth subscription, work SSO, …

With explicit providers, the contract becomes:
- config chooses the backend (`llm.provider`)
- auth store decides how that backend is authenticated (within that provider)

## Practical implication

“Switching payment method” can mean two different actions:

1. Switch auth method within a provider (no config change)
   - Example: Anthropic API key ↔ Anthropic OAuth

2. Switch execution backend (config change, but UI-assisted)
   - Example: `dexto` ↔ `anthropic`
   - Example: `dexto` ↔ `openrouter` (advanced)

## Design guardrails

- Keep secrets out of YAML; put them into the auth store / platform secret injection.
- Ensure the UI can show “available backends” for a model and which auth methods are configured.
