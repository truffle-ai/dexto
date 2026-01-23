# User-Facing Config and “No Escape Hatches”

## Decision: no `provider: dexto` in user config

This feature is unreleased, so we should not introduce a user-facing “escape hatch” where users can directly configure `llm.provider: dexto`.

**Rationale**
- It couples “what model” to “how to pay” and becomes technical debt immediately.
- It complicates UX and documentation (“when should I use dexto vs anthropic?”).
- It creates long-term migration/compat concerns once configs are deployed/shared.
- We already have a cleaner conceptual split: provider/model is the semantic selection; auth/routing is how we execute it.

**Implementation implication**
- Treat “dexto” as an internal *effective provider* only (routing target), not a valid provider in user-authored configs.

## What user config should mean

User config should express “what you want to talk to”, not “how it gets billed”.

Examples (conceptual):

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
```

OpenRouter-only models are expressed explicitly as OpenRouter IDs:

```yaml
llm:
  provider: openrouter
  model: z-ai/glm-4.5-air:free
```

## Gateway reality: Dexto == OpenRouter

Routing to the Dexto gateway means the *actual* request is OpenRouter-style:
- Dexto base URL: `https://api.dexto.ai/v1`
- Model IDs: OpenRouter format (typically `vendor/model`), or vendor-prefixed IDs where applicable.

Therefore:
- Any time we route “via Dexto”, we must ensure the model ID is in OpenRouter-compatible format.
- Any time we show UX labels, we should show the *semantic* provider (Anthropic/OpenAI/etc.), not “dexto”.

## Practical guardrails (recommended)

1. **Validation boundary**: reject user configs that set `provider: dexto`.
2. **API boundary**: catalog should never list `dexto` as a selectable provider.
3. **UI boundary**: model picker should never show “dexto” as a provider option.
4. **Internal boundary**: routing may still produce `effectiveProvider: 'dexto'` for execution.

