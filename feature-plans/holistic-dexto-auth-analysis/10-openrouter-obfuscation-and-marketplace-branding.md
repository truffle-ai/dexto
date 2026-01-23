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

Recommendation:
- Keep internal provider ID as `openrouter` for “marketplace namespace” models.
- Rename UI/labels to “Dexto Marketplace” (or similar).
- Ensure key gating uses “effective credentials” so users aren’t pushed to create OpenRouter keys when logged into Dexto.

What to avoid:
- Making users set `provider: dexto` in config to “hide openrouter”.
  - That couples selection to billing, makes auth switching harder, and creates future migration risk.

## Suggested UX semantics

1. “Marketplace models” are described as “available through Dexto Credits”.
2. Users can still “Bring your own OpenRouter key” as an advanced option, but it’s not the default onboarding path.
3. The model ID field can be called “Model ID” (not “OpenRouter model ID”), and the validation link can point to Dexto docs or a Dexto-hosted catalog page (even if it’s backed by OpenRouter).

