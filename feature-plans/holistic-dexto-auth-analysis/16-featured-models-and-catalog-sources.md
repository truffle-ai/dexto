# Featured Models and Catalog Sources (Dexto-first)

This document is about making Dexto gateway feel “batteries included”:
- a short, high-signal preset list for most users
- the ability to use *any* OpenRouter model ID when needed

## Recommendation: add “featured models” to the registry

Add a curated set of models under `LLM_REGISTRY.dexto.models`:
- store model IDs in OpenRouter format (e.g., `openai/gpt-5.2-pro`, `anthropic/claude-sonnet-4.5`)
- keep `supportsCustomModels: true` so users can still enter any OpenRouter model ID

Rationale:
- Works consistently across CLI + WebUI without relying on a remote catalog at render time
- Provides a stable, opinionated default list that you can curate for “coding agent” needs
- Keeps “long tail” access via custom models without exploding the UI

## Should OpenRouter also have featured models?

Optional.

If `openrouter` is treated as “advanced BYOK”, it can remain:
- discoverable but not prominent
- with an empty preset list (user types/searches IDs)

If you want symmetry, you can add a small featured list there too, but it increases duplication.

## Dynamic catalogs (OpenRouter API vs models.dev)

### OpenRouter API (best for “any model”)

Use for:
- validating arbitrary OpenRouter IDs
- search/autocomplete for the long tail

We already have groundwork:
- `packages/core/src/llm/providers/openrouter-model-registry.ts` (cache + TTL)

### models.dev (best for “metadata + grouping”, not completeness)

Use for:
- richer metadata on featured models (capabilities, pricing, token limits)
- cross-provider grouping hints (`family`, `name`, `release_date`) to power “Run via …” toggles

Do not use as the only source of truth for OpenRouter availability:
- it’s not a complete OpenRouter catalog

## UX: one model card, multiple backends

For featured models, the picker can show a single card and let users choose:
- Dexto (recommended)
- Direct provider (if configured)
- OpenRouter BYOK (advanced)

This requires a mapping table for featured models:
- for each model group, define the provider/model pair for each backend variant

For non-featured models:
- allow “custom model ID” under `dexto` (default) and under `openrouter` (BYOK)
