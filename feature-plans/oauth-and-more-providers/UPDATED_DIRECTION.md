# Updated Direction — OAuth + Provider Catalog Revamp

Date: **2026-02-18**

This is an addendum to [`PLAN.md`](./PLAN.md). It captures key insights discovered after Phase 1 scaffolding landed, and updates the direction for achieving “pi parity” (broad provider/model coverage) without re-architecting the system.

## 1) Key Verifications (OpenCode + models.dev)

### 1.1 No “last 6 months” model filtering in current OpenCode

What OpenCode actually does today:
- Model picker shows **Favorites** and **Recent (last used)** sections, and hides models with `status === "deprecated"`.
  - Source: `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx`

What we did *not* find:
- Any OpenCode or models.dev code that filters the catalog by `release_date` (eg “only show models released in the last 6 months”).
  - models.dev web UI only supports search + sort; no time-window filter:
    - Source: `~/Projects/external/models.dev/packages/web/src/index.ts`

> If we want a “hide ancient models” UX, we should implement it explicitly (likely as an optional scope in our catalog endpoints), not assume it exists upstream.

### 1.2 OpenCode’s OpenRouter model list is incomplete because models.dev is curated

OpenCode’s provider catalog is derived from models.dev (`https://models.dev/api.json`), not OpenRouter’s live `/models` endpoint:
- Source: `~/Projects/external/opencode/packages/opencode/src/provider/models.ts`
- Source: `~/Projects/external/opencode/packages/opencode/src/server/routes/provider.ts`

**Implication:** OpenCode can only show the subset of OpenRouter models that models.dev tracks.

Concrete example (verified):
- OpenRouter live catalog includes `openai/gpt-3.5-turbo-0613` (`https://openrouter.ai/api/v1/models`).
- models.dev’s OpenRouter provider does **not** include that model (`https://models.dev/api.json`).

Also, models.dev’s OpenRouter provider is a committed TOML snapshot:
- Source: `~/Projects/external/models.dev/providers/openrouter/provider.toml`
- Source: `~/Projects/external/models.dev/providers/openrouter/models/`

So: “OpenCode doesn’t list some OpenRouter models” is not a transport limitation; it’s a **catalog source** choice.

## 2) Direction: Follow pi’s “multi-source model registry” approach

pi does not rely on a single upstream catalog. It generates a merged model list from multiple sources:
- models.dev fetch + normalization
- OpenRouter fetch + normalization
- Additional gateway catalogs (eg Vercel AI Gateway) fetch + normalization

Reference:
- `~/Projects/external/pi-mono/packages/ai/scripts/generate-models.ts`

We should adopt the same idea in Dexto’s sync pipeline:

### 2.1 Keep models.dev as the baseline for direct providers

models.dev is still valuable for:
- provider IDs + names + env var hints + docs links
- cross-provider model metadata (modalities, tool-call, pricing, context)

### 2.2 Additionally ingest gateway catalogs (starting with OpenRouter)

We should treat gateway catalogs as their own sources, because models.dev may be intentionally curated.

For Dexto, the immediate high-value source is:
- OpenRouter live model catalog (`https://openrouter.ai/api/v1/models`)

Notes:
- Dexto already has a runtime OpenRouter validator/cache (TTL + throttle) at:
  - `packages/core/src/llm/providers/openrouter-model-registry.ts`
- That runtime cache is great for “is this ID valid?”, but it doesn’t automatically improve our *static* model picker/catalog unless we integrate it into our registry generation or expose it as a dynamic catalog endpoint.
- Dexto Nova gateway is a wrapper on openrouter so it will have the exact same supported model list and names

### 2.3 Also ingest Vercel AI Gateway’s live model catalog

pi also fetches Vercel AI Gateway’s model catalog and treats it as a first-class source:
- Endpoint: `https://ai-gateway.vercel.sh/v1/models`
- Reference: `~/Projects/external/pi-mono/packages/ai/scripts/generate-models.ts` (`fetchAiGatewayModels()`)

This matters for the same reason as OpenRouter:
- models.dev may be stale or curated compared to the live gateway catalog.
- We can keep our core transport surface small, but still keep a path to “all models” by ingesting gateway catalogs separately.

### 2.4 Deterministic merge + de-dupe strategy (keep the path to “all models”)

pi’s merge strategy is intentionally simple and stable:
- Merge sources in a fixed order (models.dev first).
- De-dupe by `(provider, modelId)`.
- Keep the first-seen model as authoritative (so models.dev wins when both have an entry; gateway sources fill gaps).

Reference:
- `~/Projects/external/pi-mono/packages/ai/scripts/generate-models.ts` (section “Group by provider and deduplicate by model ID”).

### 2.5 Provider identity: models.dev provider IDs are canonical (no back-compat)

Decision (owner): treat **models.dev provider IDs** as our canonical, user-facing provider IDs.

Implications:
- Expand core’s `LLMProvider` to include all models.dev provider IDs (generated from the provider snapshot).
- Deprecate/remove Dexto-local legacy IDs (e.g. `glm`, `vertex`, `bedrock`) in favor of models.dev IDs (e.g. `zhipuai`, `google-vertex`, `amazon-bedrock`).
- Keep a small Dexto-only overlay for providers that are not on models.dev (e.g. `dexto-nova`, `openai-compatible`, `local`, `ollama`).
- No aliases/backward compatibility required: breaking config changes are acceptable.

## 3) “Minimal transports” is still a viable base (with a clear path to pi parity)

The earlier “minimal transports” statement refers to the **request-shape layer** (which SDK surface we target), not the size of the model catalog.

We can keep the initial transport set small while preserving a path to pi-style parity:

### 3.1 Add a stable internal transport discriminator (extensible)

pi uses an explicit `api` discriminator (eg `"openai-completions"`, `"openai-responses"`, `"anthropic-messages"`, …) and then routes to a small set of adapters.
- Source: `~/Projects/external/pi-mono/packages/ai/src/types.ts`

In Dexto, we can do the same with a small internal `TransportKind` (or `ApiKind`) used by our LLM factory:
- Start small (enough for most providers): OpenAI Chat, OpenAI Responses, Anthropic, Google, OpenRouter, Bedrock, Vertex.
- Add additional kinds incrementally (Azure, Copilot, etc.) without changing the overall architecture.

### 3.2 Use `models.dev provider.npm` as the *default* transport hint (not the whole truth)

models.dev has a provider-level `npm` field that indicates the intended Vercel AI SDK provider package.
- This is a strong default for transport selection.
- It’s not sufficient for all edge cases (some providers need custom headers, region logic, or per-model routing).

pi demonstrates this exact pattern:
- For OpenCode Zen models, they map `model.provider.npm` → `api` and then still add special-case routing where needed.
  - Source: `~/Projects/external/pi-mono/packages/ai/scripts/generate-models.ts`

## 4) Phase 1 recap (already implemented) + remaining gaps

### 4.1 Implemented in this repo (Phase 1 scaffolding)

Shipped building blocks:
- Core runtime auth contract:
  - `packages/core/src/llm/auth/types.ts`
- Multi-profile store + defaults:
  - `packages/agent-management/src/auth/llm-profiles.ts`
- Runtime resolver that converts the active profile into request overrides (apiKey/headers/baseURL/fetch) and handles token refresh logic:
  - `packages/agent-management/src/auth/runtime-auth-resolver.ts`
- Server surface for connect providers + redacted profiles/defaults:
  - `packages/server/src/hono/routes/llm-connect.ts`
- CLI interactive `/connect`:
  - `packages/cli/src/cli/commands/connect/index.ts`

### 4.2 Known follow-up gaps

- `/connect` currently overwrites credentials because `profileId` is fixed to `${providerId}:${methodId}`:
  - Source: `packages/cli/src/cli/commands/connect/index.ts`
  - We need “auth slot” UX: keep deterministic IDs, but **don’t silently overwrite**.
    - Allow switching defaults without re-auth by selecting an existing slot.
    - If the slot already exists, prompt the user to replace credentials (explicit confirm) vs keep existing.

## 5) Changes this implies for the tasklist

We should update the plan’s next phases to include:
- Multi-profile UX completion (create multiple profiles; switch active; delete).
- Sync pipeline changes:
  - ingest gateway catalogs (OpenRouter first) in `sync-llm-*`
  - generate a provider snapshot (name/env/doc/npm/api) for `/connect` and onboarding
  - keep model snapshot generation separate from gateway live validation
- LLM factory refactor:
  - table-driven “boring providers” based on `npm` + `api` baseURL
  - keep explicit code only for real exceptions (dexto-nova, openrouter, bedrock, vertex, oauth URL rewrites, local/ollama)
