# Execution Backend Selection and “Out of Credits” Handling

With explicit providers, “routing” is no longer a runtime decision: it’s the config.

## Goal

Make switching between backends easy (Dexto ↔ direct ↔ OpenRouter), without hidden behavior.

## Credential inputs (by provider)

- `dexto` provider → `DEXTO_API_KEY` (from `dexto login`)
- `openrouter` provider → `OPENROUTER_API_KEY` (BYOK)
- direct providers (`anthropic`, `openai`, `google`, …) → their native env vars / auth store

## Execution semantics

Given `(provider, model)` from config:

- If `provider === 'dexto'`:
  - Call `https://api.dexto.ai/v1`
  - Pass `model` as an OpenRouter model ID (no rewriting)
- If `provider === 'openrouter'`:
  - Call OpenRouter
  - Pass `model` as an OpenRouter model ID (no rewriting)
- If `provider` is a direct provider:
  - Call the native provider SDK/API
  - Pass `model` in that provider’s native namespace

## “Ran out of credits” (402) behavior

Do **not** silently fall back to another provider at runtime.

Instead:
- surface a typed `INSUFFICIENT_CREDITS` error
- include a recovery hint that the UI/CLI can act on:
  - “Switch to Direct Anthropic (key is configured)”
  - “Switch to OpenRouter (key is configured)”

This keeps execution deterministic and makes the “switch” a deliberate UX action.
