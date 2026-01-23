# Custom Models and the OpenRouter Surface Area (Dexto-first)

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
- Any OpenRouter model ID should be usable with `provider: dexto`.
- Users should be able to add arbitrary OpenRouter model IDs without needing an OpenRouter account.

## UX problem to solve (new explicit-provider world)

We need **two** “OpenRouter ID” custom-model experiences:

1. **Dexto custom models** (default, recommended)
   - `provider: dexto`
   - `model: <openrouter_model_id>`
   - credential: `DEXTO_API_KEY`

2. **OpenRouter custom models** (advanced BYOK)
   - `provider: openrouter`
   - `model: <openrouter_model_id>`
   - credential: `OPENROUTER_API_KEY`

The WebUI should make this explicit and avoid pushing OpenRouter key setup during Dexto onboarding.

## Model ID considerations

OpenRouter IDs come in multiple shapes:
- `vendor/model` (typical)
- Vendor-prefixed IDs that are not tied to a single “provider” concept (some Groq catalog IDs, etc.)

Practical guidance:
- For `provider: dexto` and `provider: openrouter`, store the OpenRouter model ID exactly as the user entered it.
- For direct providers, store the provider-native ID.
