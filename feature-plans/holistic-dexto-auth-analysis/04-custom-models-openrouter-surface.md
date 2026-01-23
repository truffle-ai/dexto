# Custom Models and the OpenRouter Surface Area

## Current custom model infrastructure (what exists)

- Custom models are persisted locally in `~/.dexto/models/custom-models.json`.
  - Schema + persistence: `packages/agent-management/src/models/custom-models.ts`
- Server exposes CRUD:
  - `GET /llm/custom-models`
  - `POST /llm/custom-models`
  - `DELETE /llm/custom-models/:name`
  - Routes: `packages/server/src/hono/routes/llm.ts`
- WebUI model picker supports adding custom models (including `openrouter` provider):
  - `packages/webui/components/ModelPicker/ModelPickerModal.tsx`

## Key requirement: “Any model Dexto gateway supports”

Since Dexto gateway proxies OpenRouter:
- Any OpenRouter model ID should be usable when routing via Dexto.
- Users should be able to add arbitrary OpenRouter models without friction.

## UX problem to solve (current behavior)

The WebUI and catalog currently treat “API key presence” as “provider API key exists”.
That is incorrect for routeable providers when Dexto auth is available.

Consequence:
- Users can be prompted to set `OPENROUTER_API_KEY` even though `DEXTO_API_KEY` is sufficient.
- This especially hurts the “add arbitrary OpenRouter model” flow.

## Proposed fixes (conceptual)

1. **API/catalog should expose “effective credential availability”**
   - Expose `hasDextoKey` and `preferDextoCredits`.
   - For each provider, expose `canRouteViaDexto` and `hasEffectiveCredentials`.
   - The UI should only block selection when **no effective credentials** exist.

2. **Strict validation should not require direct keys if Dexto can satisfy execution**
   - In headless/server modes, a config like `provider: openrouter` should be valid with only `DEXTO_API_KEY` present.

3. **Custom model form should be Dexto-aware**
   - If Dexto auth is active and preferred, don’t require an OpenRouter key to save/use an OpenRouter custom model.
   - Still allow setting an OpenRouter key for users who want to force “direct OpenRouter”.

## Model ID considerations

OpenRouter IDs come in multiple shapes:
- `vendor/model` (typical)
- Vendor-prefixed IDs that are not tied to a single “provider” concept (some Groq catalog IDs, etc.)

Practical guidance:
- For custom OpenRouter models, store the ID exactly as the user entered it.
- For semantic providers routed via Dexto, transform model IDs using the shared mapping function (do not reimplement prefix logic).

