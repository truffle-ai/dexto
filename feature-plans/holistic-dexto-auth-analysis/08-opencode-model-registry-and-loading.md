# OpenCode “LLM Registry” Equivalent (Models.dev + Overlays)

OpenCode does have a “registry-like” layer, but it’s **dynamic** and sourced from `models.dev` rather than a static curated list like Dexto’s `LLM_REGISTRY`.

## Source of truth: models.dev

- OpenCode pulls a provider+model catalog from `https://models.dev/api.json`.
- Implementation: `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/models.ts`
  - Caches to a local file (`Global.Path.cache/models.json`).
  - Refreshes on an interval (hourly).
  - Has a macro fallback (`models-macro`) if network fetch is unavailable.

The models.dev payload includes a lot of what we manually encode in `LLM_REGISTRY`, such as:
- per-model capabilities (attachments, reasoning, tool calling, etc.)
- token limits
- pricing metadata (input/output/cache)
- provider env vars (e.g. `OPENROUTER_API_KEY`)

## Registry building: parse models.dev into internal provider/model types

OpenCode converts models.dev records into internal types:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts`
  - `fromModelsDevProvider()` and `fromModelsDevModel()`
  - Adds internal “variants” for reasoning effort etc via `ProviderTransform.variants()`

This is a “registry build step” very similar in spirit to Dexto’s `LLM_REGISTRY`, just fed by an upstream dataset.

## Overlay mechanism: config can extend/override the registry

OpenCode lets users add/override providers/models via their config file:
- Config schema: `/Users/karaj/Projects/external/opencode/packages/opencode/src/config/config.ts`
  - `Config.Provider` extends `ModelsDev.Provider.partial()`
  - `provider.models` is a freeform record of models that can override/add entries.
- Merge happens in provider state init:
  - `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts` (“extend database from config”)

This is effectively their “custom models” system.

## Provider/model addressing: always a single `provider/model` string

OpenCode uses a consistent model addressing scheme:
- Config stores `model: "provider/model"` (string)
- Runtime parses with:
  - `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts` (`parseModel`)

No separate `(provider, model)` fields; they always treat it as a combined ID.

Important detail:
- `parseModel()` splits on the **first** `/` and rejoins the rest.
  - This allows OpenRouter-style IDs (which themselves contain `/`) to still work when OpenRouter is the provider.
  - Example config value: `openrouter/anthropic/claude-3.5-sonnet`
    - `providerID = "openrouter"`
    - `modelID = "anthropic/claude-3.5-sonnet"`

## Transform layer: provider-specific tweaks live outside the registry

They have a dedicated transformation layer:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/transform.ts`
  - message normalization rules (Anthropic empty content, Mistral toolCallId constraints, etc.)
  - defaults (temperature/topP/topK) by model family
  - reasoning variants per provider SDK (`@openrouter/ai-sdk-provider` vs native SDKs)

This is a useful separation: “catalog metadata” vs “request-shaping quirks”.

## Takeaways for Dexto

1. **Layering is powerful**: upstream catalog → local overrides → auth-dependent filtering.
2. **Keep “transform” centralized**: OpenCode’s `ProviderTransform` avoids sprinkling provider quirks everywhere.
3. **Custom models can be either**
   - “config overlay” (OpenCode), or
   - “separate persisted list + UI” (Dexto).
   Dexto’s approach is more user-friendly; OpenCode’s is more flexible for power users.

## Why OpenCode doesn’t have the “native ↔ OpenRouter model ID mismatch” problem

OpenCode treats “OpenRouter” as an explicit provider:
- If you select `anthropic/...`, you’re using Anthropic’s namespace and auth.
- If you select `openrouter/...`, you’re using OpenRouter’s namespace and auth.

Because of that explicitness, they do not need a transparent mapping layer between native IDs and OpenRouter IDs.

