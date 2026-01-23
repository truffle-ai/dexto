# CLI, WebUI, and API Implications

## CLI setup

If we’re going explicit-provider:
- The setup wizard should write `llm.provider: dexto` by default (not a direct provider).
- The model it writes should be an OpenRouter ID (because Dexto gateway is OpenRouter-backed).

## WebUI model picker

The model picker should present a single “model card” and let users choose an execution backend:
- “Run via: Dexto / Direct / OpenRouter”
- disabled states based on auth availability

Concrete implication:
- `/llm/catalog` needs to treat `dexto` as a first-class provider in the response (not hidden),
  and `hasApiKey` for `dexto` should mean `DEXTO_API_KEY` is configured.

The previous “effective credentials” bug (treating `DEXTO_API_KEY` as satisfying `openrouter`) becomes irrelevant
if we keep providers strict:
- `dexto` requires `DEXTO_API_KEY`
- `openrouter` requires `OPENROUTER_API_KEY`

## Server API

Today:
- `/llm/catalog` exposes `hasApiKey` as “provider key exists”.

Recommended evolution (conceptual):
- Add a backend-aware “switch target” shape to the model catalog so the UI can implement
  “Run via: …” toggles without hardcoding mappings.

This keeps “UI decision logic” out of the UI and makes it consistent across WebUI and CLI.

## “No legacy escape hatches” enforcement points

- Remove auth-dependent runtime rerouting (no hidden “prefer Dexto” switching).
- Make `dexto` explicitly selectable; keep `openrouter` explicitly “advanced”.
