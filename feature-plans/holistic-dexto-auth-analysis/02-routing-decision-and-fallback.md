# Routing Decision, Credential Precedence, and Fallback

## Goals

1. **Seamless auth switching**
   - User starts on Dexto Credits.
   - Balance hits 0 → agent should be able to continue using BYOK automatically if configured.
2. **Correct model ID transformation**
   - When routing to Dexto (OpenRouter proxy), transform model IDs correctly (including vendor-prefix mapping like `xai` → `x-ai`).
3. **Avoid UI/key confusion**
   - “Missing API key” should not block if Dexto auth can satisfy the call.

## Credential inputs

- `DEXTO_API_KEY` (from `dexto login`)
- Direct provider API key (e.g. `ANTHROPIC_API_KEY`)
- OpenRouter API key (`OPENROUTER_API_KEY`) for direct OpenRouter usage

## Recommended routing algorithm (high level)

Given semantic `(provider, model)` from config:

1. If provider is **direct-only** (bedrock/vertex/local/etc.) → always direct.
2. Otherwise, compute:
   - `hasDextoKey`
   - `hasDirectKeyForProvider`
   - `preferDextoCredits` (defaults true)
3. Choose primary route:
   - If `hasDextoKey` and (`!hasDirectKeyForProvider` or `preferDextoCredits`) → route via Dexto.
   - Else if `hasDirectKeyForProvider` → route direct.
   - Else → error: no credentials.
4. Transform model ID *only* if routing via Dexto and the semantic provider is not already OpenRouter-native.

## 402 fallback for “ran out of credits”

To make switching truly seamless, implement a controlled retry:

- If the primary route is Dexto **and** the gateway returns `402 INSUFFICIENT_CREDITS`,
  then **retry once** using the direct provider route *if* a direct provider API key exists.

This avoids forcing `dexto logout` (which is global state and a bad UX for multi-agent and platform scenarios).

## Model ID transformation (don’t duplicate logic)

The codebase already has a provider-prefix mapping for OpenRouter targets:
- `packages/core/src/llm/registry.ts` (`OPENROUTER_PROVIDER_PREFIX`, `transformModelNameForProvider`)

**Recommendation**
- Routing should reuse `transformModelNameForProvider()` (or an extracted helper), rather than implementing its own `${provider}/${model}` prefixing.
- This avoids incorrect IDs (notably `xai` → `x-ai`) and avoids future drift.

## Observable routing state

Expose routing in a way that UI can make correct decisions:
- Whether Dexto auth is available (`hasDextoKey`)
- Whether the semantic provider is routeable (`canRouteViaDexto`)
- Which route would be chosen given current settings (`effectiveRoute`)

This is required to prevent WebUI/CLI from prompting users for provider API keys unnecessarily.

