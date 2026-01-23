# Model ID Namespaces and Mapping (Native ↔ OpenRouter ↔ Dexto)

This is the “hard part” behind the transparent gateway: **Dexto gateway requires OpenRouter model IDs**, while “semantic provider selection” wants native provider IDs.

## Problem statement

We want:
- User selects `provider: anthropic` + a Claude model (semantic selection).
- If Dexto auth is available/preferred, the request routes via Dexto gateway (`api.dexto.ai`).
- The gateway expects an OpenRouter model ID (typically `vendor/model`), which may not match the native provider’s model ID.

Examples of potential mismatch:
- Native Anthropic IDs often include release-date suffixes.
- OpenRouter IDs are frequently “friendly slugs” and may omit dates.

If we don’t solve this mapping, either:
- routing breaks (wrong model ID), or
- auth switching breaks (users must rewrite configs to switch between Dexto vs direct).

## Current Dexto implementation (as of today)

- Transparent routing decision exists:
  - `packages/core/src/llm/routing.ts`
- A simple OpenRouter prefix transform exists in the registry:
  - `packages/core/src/llm/registry.ts` (`transformModelNameForProvider`, `OPENROUTER_PROVIDER_PREFIX`)
- OpenRouter catalog validation exists (dynamic list + context length cache):
  - `packages/core/src/llm/providers/openrouter-model-registry.ts`

**Gap**
- We do not have a durable “native ↔ OpenRouter” mapping layer for curated models.
  - Prefixing is not sufficient if the upstream model ID differs from OpenRouter’s ID.

## Options

### Option 1: Store OpenRouter IDs everywhere

Pros:
- Routing to Dexto is trivial (no mapping).

Cons:
- Direct-provider BYOK becomes painful unless we can reliably map OpenRouter IDs back to native IDs.
- This violates the “seamless switching” requirement unless we add substantial mapping logic anyway.

### Option 2: Store native IDs for semantic providers (recommended)

Config stays “semantic”:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
```

When routing via Dexto:
- Convert to OpenRouter ID using an explicit mapping table for curated models.
- For long-tail OpenRouter-only models, users select `provider: openrouter` and provide the OpenRouter ID directly:

```yaml
llm:
  provider: openrouter
  model: z-ai/glm-4.5-air:free
```

Pros:
- Switching Dexto ↔ direct doesn’t require rewriting provider/model for common “first-class” providers.
- Platform config remains interpretable (“this agent uses Anthropic Sonnet…”).

Cons:
- Requires us to maintain a mapping for the curated models we care about.

### Option 3: Introduce a first-class “marketplace namespace” in config

Example concept:

```yaml
llm:
  modelRef:
    namespace: marketplace
    id: z-ai/glm-4.5-air:free
```

Pros:
- Cleans up the “OpenRouter provider” semantics.

Cons:
- This is a bigger schema change and creates a new long-term config surface area we must support forever.

## Recommendation

1. Keep semantic provider/model in config for first-class providers.
2. Keep `provider: openrouter` for marketplace/long-tail IDs (even if we later brand it differently in UX).
3. Add an explicit per-model `openrouterId` (or similar) mapping for curated models in the registry so Dexto routing can always produce a correct gateway model ID.
4. Do not use “prefixing only” as the mapping strategy. Use it as a fallback when the mapping is known to be identical.

## Should we use models.dev for mapping?

OpenCode uses models.dev as its upstream catalog, but that does **not** solve the core Dexto problem:
- models.dev provides per-provider model IDs, not a guaranteed cross-provider equivalence mapping between “Anthropic native” and “OpenRouter’s Anthropic”.

If we want a dynamic catalog for UX/search and validation:
- OpenRouter’s models API (already partially integrated via our cache) is a better fit because Dexto gateway is OpenRouter-backed.

