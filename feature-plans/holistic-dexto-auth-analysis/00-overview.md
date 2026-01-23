# Holistic Dexto Auth + Routing Analysis

This folder is a working set of notes/design decisions for the “transparent Dexto gateway” feature.
The goal is to keep all the auth/routing/model-ID concerns in one place so we can iterate without losing context.

**Key framing**
- Dexto gateway is an OpenRouter proxy with Dexto billing on top.
- Users select “real” providers/models (Anthropic/OpenAI/etc.) in UX; Dexto is infrastructure.
- We want seamless switching between Dexto Credits and BYOK (provider API keys), including “run out of credits”.
- We want OpenRouter-only models to be first-class (via custom models) and also route through Dexto when logged in.
- This feature is unreleased: we should avoid introducing “legacy escape hatches” that we don’t intend to support long-term.

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

## Current implementation references (for context)

- Runtime routing module: `packages/core/src/llm/routing.ts`
- Registry-based OpenRouter prefix transform: `packages/core/src/llm/registry.ts` (`transformModelNameForProvider`)
- Vercel AI SDK provider factory (where routing is applied): `packages/core/src/llm/services/factory.ts`
- CLI setup “Dexto Credits” flow (stores native provider/model): `packages/cli/src/cli/commands/setup.ts`
- WebUI model picker + custom model form: `packages/webui/components/ModelPicker/ModelPickerModal.tsx`
- Server catalog + custom-model endpoints: `packages/server/src/hono/routes/llm.ts`
- Custom models persistence: `packages/agent-management/src/models/custom-models.ts`
