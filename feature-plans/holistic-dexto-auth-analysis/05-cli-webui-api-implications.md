# CLI, WebUI, and API Implications

## CLI setup

The CLI already has a “Dexto Credits” setup path that stores native provider/model:
- `packages/cli/src/cli/commands/setup.ts` (`handleDextoProviderSetup`)

What we still need for “seamless switching”:
- A routing policy (prefer Dexto vs prefer direct) that is not tied to login/logout.
- A 402 fallback path (retry with direct key if configured).

## WebUI model picker

The WebUI supports:
- Catalog models (from `/llm/catalog`)
- Custom models (from `/llm/custom-models`)
- A “via Dexto” indicator (from `/llm/current`)

Missing piece:
- The picker’s “API key required” gating must consider Dexto auth availability + routing policy.

**Concrete current bug**
- The model picker blocks selection if `provider.hasApiKey === false`:
  - `packages/webui/components/ModelPicker/ModelPickerModal.tsx` (`onPickModel`)
- `/llm/catalog` currently sets `hasApiKey` from `getProviderKeyStatus(provider)`:
  - `packages/server/src/hono/routes/llm.ts`
- `getProviderKeyStatus('openrouter')` only checks `OPENROUTER_API_KEY` and ignores `DEXTO_API_KEY`:
  - `packages/agent-management/src/utils/api-key-store.ts`

Result:
- In WebUI, users cannot select an OpenRouter model unless they also configure `OPENROUTER_API_KEY`,
  even if they are logged into Dexto and the model would successfully route via the Dexto gateway.

Concrete implication:
- `/llm/catalog` needs to expose enough data for the UI to know:
  - whether Dexto login exists,
  - whether a provider is routeable via Dexto,
  - whether selecting a model is blocked or allowed without provider-specific keys.

## Server API

Today:
- `/llm/current` exposes `routing.viaDexto` as a boolean.
- `/llm/catalog` exposes `hasApiKey` as “provider key exists”.

Recommended evolution (conceptual):
- Add an auth/routing summary object to `/llm/catalog`:
  - `auth.hasDextoKey`
  - `auth.preferDextoCredits`
- Add per-provider flags:
  - `canRouteViaDexto`
  - `hasEffectiveCredentials`

This keeps “UI decision logic” out of the UI and makes it consistent across WebUI and CLI.

## “No escape hatch” enforcement points

If we decide “no user-facing `provider: dexto`”:
- Reject it at config validation boundary.
- Ensure `/llm/catalog` filters `dexto` (already does via `hidden`).
- Ensure the setup wizard never writes it.
