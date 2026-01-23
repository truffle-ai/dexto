# WebUI Effective Credentials (Dexto-aware “API key required” gating)

## Why this doc exists

Dexto gateway is meant to make OpenRouter models usable with only `DEXTO_API_KEY`.
Today, the WebUI blocks those selections unless `OPENROUTER_API_KEY` is set.

## Current behavior (concrete)

1. WebUI uses `/llm/catalog` to build the model list.
2. When a user clicks a model, the picker checks `provider.hasApiKey` and blocks if false:
   - `packages/webui/components/ModelPicker/ModelPickerModal.tsx` (`onPickModel`)
3. `/llm/catalog` populates `hasApiKey` using direct provider key status only:
   - `packages/server/src/hono/routes/llm.ts` (`getProviderKeyStatus(provider)`)
4. For `provider=openrouter`, key status is determined only from `OPENROUTER_API_KEY`:
   - `packages/agent-management/src/utils/api-key-store.ts`

Therefore:
- A user with only `DEXTO_API_KEY` cannot select OpenRouter models in WebUI, even though runtime routing would succeed via Dexto.

## Desired behavior

The UI should gate on **effective credentials**, not “direct provider API key exists”.

Effective credentials for a provider/model should consider:
- `DEXTO_API_KEY` availability
- whether the provider is routeable via Dexto
- user routing preference (prefer Dexto vs prefer direct)
- direct provider keys (and OpenRouter key when direct OpenRouter is chosen)

## Recommended API evolution

Extend `/llm/catalog` response to include:

1. Global auth summary:
   - `auth.hasDextoKey`
   - `auth.preferDextoCredits`

2. Per-provider routing+credential fields:
   - `canRouteViaDexto`
   - `hasEffectiveCredentials`
   - (optional) `credentialSources: { dexto: boolean; direct: boolean }`

Then:
- WebUI gates selection on `hasEffectiveCredentials`.
- WebUI can show “via Dexto” (or equivalent) badges for providers/models where the chosen route would be Dexto.

## Recommended WebUI behavior

1. If a provider has effective credentials, allow selecting its models.
2. Only show the API key modal when **no effective credential path exists**.
3. For “marketplace models” (OpenRouter IDs):
   - If `hasDextoKey` is true and Dexto is preferred, do not push users into entering `OPENROUTER_API_KEY`.
   - Still allow users to configure `OPENROUTER_API_KEY` if they explicitly want “direct OpenRouter”.

