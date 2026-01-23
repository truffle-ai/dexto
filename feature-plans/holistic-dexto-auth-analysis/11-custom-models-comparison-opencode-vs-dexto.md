# Custom Models: OpenCode vs Dexto

## Dexto today

Dexto has an explicit “custom models” subsystem:
- Storage: `packages/agent-management/src/models/custom-models.ts` (`~/.dexto/models/custom-models.json`)
- WebUI: custom model form/wizard
  - `packages/webui/components/ModelPicker/CustomModelForms.tsx`
  - `packages/webui/components/ModelPicker/ModelPickerModal.tsx`
- Server API: CRUD endpoints
  - `packages/server/src/hono/routes/llm.ts`

This is good for:
- adding arbitrary OpenRouter model IDs
- adding arbitrary Dexto-gateway model IDs (same namespace; different credential)
- adding self-hosted endpoints (openai-compatible / litellm)
- per-model overrides (apiKey/baseURL/token caps)

## OpenCode approach

OpenCode does not have a separate persisted “custom-models.json” file.
Instead, it allows:
- Registry source: `models.dev`
- Overlay via config:
  - `/Users/karaj/Projects/external/opencode/packages/opencode/src/config/config.ts` (`provider.models`)
  - merged in `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts`

This is powerful but less discoverable:
- users must edit config to add models/providers
- no dedicated UI for “add custom model” (at least in the TUI path)

## Takeaways for Dexto

1. Dexto’s UX-first custom model flow is the right direction for “marketplace” models.
2. OpenCode’s overlay idea is still useful for “power user” scenarios:
   - it’s a single config artifact that can be shared
   - it supports adding providers/models without extra files

If we care about platform deployment portability:
- consider whether custom models should also be representable in agent YAML (not only in `~/.dexto/models/custom-models.json`).
  - Today, Dexto custom models are a local-user concept; that’s a mismatch for deployed agents.
