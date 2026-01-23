# OpenRouter-only Models Today, Native OAuth Tomorrow (e.g., Z.ai)

## Problem

Some models we want to support are not “native providers” in our registry today:
- Example: `z-ai/glm-*` (available via OpenRouter / Dexto gateway now)

But long term, a vendor may introduce:
- a direct API
- an OAuth subscription integration
- a separate billing model

We need a config+UX representation that doesn’t paint us into a corner.

## Recommended representation: keep selection stable, treat auth as pluggable

Store the model in the “marketplace namespace” (currently OpenRouter IDs), but keep auth/routing independent:

- Selection: “this model ID”
- Execution: “use Dexto Credits / use direct provider / use vendor OAuth”

This avoids forcing migrations when a vendor becomes first-class later.

## UX implication

When we eventually add a native `zai` provider + OAuth:
- Users should not be forced to rewrite all configs.
- We can offer an *optional* “use native provider” switch:
  - same model family, different execution backend

## Technical implication

We need a consistent internal model identity that can map to multiple backends over time:
- `modelRef = { namespace: 'marketplace', id: 'z-ai/glm-...' }`
  - later, also support `namespace: 'zai'`

If we keep using `llm.provider: openrouter` for marketplace models:
- That is fine as long as the UI doesn’t treat it as “you must have an OpenRouter account”.
- It becomes an implementation detail.

If we instead invent a new `marketplace` provider:
- That reduces OpenRouter branding exposure but introduces a new provider ID in configs (which we then have to support forever).
  - If you do this, do it once, early, before release.

