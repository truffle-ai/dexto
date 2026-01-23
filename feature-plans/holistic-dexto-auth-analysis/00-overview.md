# Holistic Dexto Auth + Model Selection (Explicit Providers)

This folder is a working set of notes/design decisions for Dexto auth + model selection.
We’re aligning with an “explicit backend provider” approach (similar to OpenCode):

- `llm.provider` is the execution backend (`dexto`, `anthropic`, `openai`, `openrouter`, …).
- Dexto gateway (`provider: dexto`) is user-facing and OpenRouter-backed.
- “Seamless switching” is primarily a UX concern (picker groups models and offers “Run via …”),
  not auth-dependent runtime routing.

**Key framing**
- Dexto gateway is an OpenRouter proxy with Dexto billing on top.
- `dexto` provider uses OpenRouter model IDs (e.g., `anthropic/claude-sonnet-4.5`).
- Direct providers use their native IDs (Anthropic IDs, OpenAI IDs, …).
- OpenRouter remains supported as BYOK/advanced; Dexto is the default recommendation.
- Custom models must work for `dexto` (OpenRouter IDs) and for other “custom endpoint” providers.

## Documents

1. `01-user-facing-config-and-no-escape-hatches.md`
2. `02-routing-decision-and-fallback.md`
3. `03-config-ownership-agent-vs-preferences.md`
4. `04-custom-models-openrouter-surface.md`
5. `05-cli-webui-api-implications.md`
6. `06-auto-update-and-migration-guidance.md`
7. `07-future-oauth-and-multi-auth.md`
8. `08-opencode-model-registry-and-loading.md`
9. `09-opencode-auth-and-provider-ux.md`
10. `10-openrouter-obfuscation-and-marketplace-branding.md`
11. `11-custom-models-comparison-opencode-vs-dexto.md`
12. `12-openrouter-only-models-and-future-native-oauth.md`
13. `13-model-id-namespaces-and-mapping.md`
14. `14-webui-effective-credentials-and-routing-awareness.md`
15. `15-opencode-provider-merge-and-precedence.md`
16. `16-featured-models-and-catalog-sources.md`

## Current implementation references (for context)

- Registry-based OpenRouter prefix transform: `packages/core/src/llm/registry.ts` (`transformModelNameForProvider`)
- Vercel AI SDK provider factory (where routing is applied): `packages/core/src/llm/services/factory.ts`
- CLI setup wizard: `packages/cli/src/cli/commands/setup.ts`
- WebUI model picker + custom model form: `packages/webui/components/ModelPicker/ModelPickerModal.tsx`
- Server catalog + custom-model endpoints: `packages/server/src/hono/routes/llm.ts`
- Custom models persistence: `packages/agent-management/src/models/custom-models.ts`
