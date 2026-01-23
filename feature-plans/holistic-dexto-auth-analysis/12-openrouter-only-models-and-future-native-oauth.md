# OpenRouter-only Models Today, Native OAuth Tomorrow (e.g., Z.ai)

## Problem

Some models we want to support are not “native providers” in our registry today:
- Example: `z-ai/glm-*` (available via OpenRouter / Dexto gateway now)

But long term, a vendor may introduce:
- a direct API
- an OAuth subscription integration
- a separate billing model

We need a config+UX representation that doesn’t paint us into a corner.

## Recommended representation (explicit-provider world)

Treat OpenRouter IDs as the “marketplace namespace” and use them under `provider: dexto` (default) or `provider: openrouter` (advanced BYOK).

When a vendor becomes first-class later (native API/OAuth), the UI can offer a switch:
- same model family
- different provider/model pair

## UX implication

When we eventually add a native `zai` provider + OAuth:
- Users should not be forced to rewrite all configs.
- We can offer an *optional* “use native provider” switch:
  - same model family, different execution backend

## Technical implication

We likely need an internal “model group” identity for UX (not config):
- group together variants across providers (Dexto/OpenRouter/direct)
- allow future “native provider” backends to join the same group
