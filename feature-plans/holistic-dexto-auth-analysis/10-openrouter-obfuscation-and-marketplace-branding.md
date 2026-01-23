# OpenRouter Obfuscation vs “Marketplace” Branding

## Reality check

If we want “any model the Dexto gateway supports”, we need an ID namespace for long-tail models.
Today, that namespace is OpenRouter model IDs (e.g. `z-ai/glm-4.5-air:free`).

So the real choice is not “use OpenRouter vs don’t”.
It’s “how much do users see the word OpenRouter?”

## Current Dexto UI exposes OpenRouter explicitly

- WebUI custom model provider list includes “OpenRouter” and links to openrouter.ai:
  - `packages/webui/components/ModelPicker/CustomModelForms.tsx`
- There is a dedicated OpenRouter validation endpoint:
  - `packages/server/src/hono/routes/openrouter.ts`

## OpenCode chose explicit OpenRouter + warning copy

OpenCode:
- exposes OpenRouter as a provider
- warns users about it and pushes their curated gateway product instead
  - `/Users/karaj/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/app.tsx`

They did not attempt to hide the dependency.

## If Dexto wants to hide OpenRouter, do it at the UX layer (not config)

With explicit providers, we don’t need to “hide OpenRouter” via config tricks.
We can keep the UX simple:

- Default recommendation: `provider: dexto`
- Advanced BYOK option: `provider: openrouter`

If you still want to minimize OpenRouter branding:
- Keep OpenRouter provider discoverable but not prominent (“Advanced”).
- Show friendly display names in pickers; avoid over-emphasizing raw OpenRouter IDs.
- Use “Dexto Marketplace” phrasing in UI while keeping internal IDs stable.

## Suggested UX semantics

1. “Marketplace models” are described as “available through Dexto Credits”.
2. Users can still “Bring your own OpenRouter key” as an advanced option, but it’s not the default onboarding path.
3. The model ID field can be called “Model ID” (not “OpenRouter model ID”), and the validation link can point to Dexto docs or a Dexto-hosted catalog page (even if it’s backed by OpenRouter).
