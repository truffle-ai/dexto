# Model ID Namespaces and Mapping (Explicit Providers + UX Grouping)

With explicit providers, we avoid the hardest runtime problem:
- `provider: dexto` always uses OpenRouter IDs
- direct providers use native IDs
- there is no auth-dependent “transparent rerouting”, so core execution doesn’t need cross-namespace mapping

What we *still* want is a **UX mapping layer** so the picker can group “the same” model and offer:
- “Run via: Dexto / Direct / OpenRouter”

## Namespaces we must support

- Dexto gateway (`dexto`): OpenRouter IDs (e.g., `anthropic/claude-sonnet-4.5`)
- OpenRouter BYOK (`openrouter`): OpenRouter IDs (same namespace)
- Native providers (`anthropic`, `openai`, …): provider-native IDs

## What the mapping layer does (and where)

The mapping layer is a UI/catalog concern, not a core-routing concern.

When a user toggles “Run via …”, we convert between provider/model pairs:

- Dexto → OpenRouter is identity (same model ID)
- Direct → Dexto/OpenRouter may require a table/heuristic (Anthropic is the main mismatch case)

## Should we use models.dev?

models.dev is useful, but it’s not a complete solution:

Pros:
- It provides per-provider model metadata (limits, capabilities, pricing)
- It includes cross-provider grouping hints (`family`, `name`, `release_date`) that can power UI grouping

Cons:
- It is not a complete OpenRouter catalog (it only includes a subset of OpenRouter models)
- It is not an authoritative “equivalence mapping” (grouping fields can be missing/inconsistent)

Recommended usage in Dexto:
- Use OpenRouter’s own catalog (existing `openrouter-model-registry.ts`) for “any model Dexto gateway supports” validation/search.
- Optionally use models.dev as a metadata/grouping enhancer for a curated “featured models” set (see `16-featured-models-and-catalog-sources.md`).

## Practical approach (recommended)

1. Maintain an explicit curated mapping for featured models:
   - for each “model group”, define the provider/model pair for `dexto`, `openrouter`, and direct providers where supported
2. For non-featured models:
   - don’t attempt to map; show them as provider-specific entries
