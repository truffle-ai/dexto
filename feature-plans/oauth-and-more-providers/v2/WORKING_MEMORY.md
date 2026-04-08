# Working Memory - V2 Provider/Auth/Reasoning Refactor

> **This file is a live scratchpad for the v2 design/alignment process.**
> Read it before continuing the discussion. Update it as decisions become clearer.

---

## How to use this file

1. Read the "Current Task" section before continuing work.
2. Update the "Key Decisions" table whenever a design branch becomes aligned.
3. Add unresolved items to "Open Questions / Blockers".
4. Keep `[grill-me-discussion.md](./grill-me-discussion.md)` as the more detailed discussion log.
5. Once the major open questions are resolved, finalize `[PLAN.md](./PLAN.md)` and use this file mainly as historical context.

---

## Current Task

**Task:** Task 8 - Runtime Hotspot Cleanup in `factory.ts` and `provider-options.ts`
**Status:** *Ready to implement*

### Plan

- extract the highest-value runtime-family hotspots from [`packages/core/src/llm/services/factory.ts`](../../../packages/core/src/llm/services/factory.ts) and [`packages/core/src/llm/executor/provider-options.ts`](../../../packages/core/src/llm/executor/provider-options.ts)
- keep the cleanup focused on painful branch clusters, not a blanket adapter layer
- preserve Task 1-7 behavior while improving the runtime-family seam for the remaining cleanup task

### Notes

- Task 1 is complete and focused on foundation only: snapshot move, registry-centered imports, `ProviderInfo.runtime` plumbing, and targeted tests.
- Task 1 changed files:
  - [`scripts/sync-llm-models.ts`](../../../scripts/sync-llm-models.ts)
  - [`packages/core/src/llm/types.ts`](../../../packages/core/src/llm/types.ts)
  - [`packages/core/src/utils/api-key-resolver.ts`](../../../packages/core/src/utils/api-key-resolver.ts)
  - [`packages/core/src/llm/registry/index.ts`](../../../packages/core/src/llm/registry/index.ts)
  - [`packages/core/src/llm/registry/providers.generated.ts`](../../../packages/core/src/llm/registry/providers.generated.ts)
  - [`packages/core/src/llm/registry/index.test.ts`](../../../packages/core/src/llm/registry/index.test.ts)
- Task 1 retained only focused coverage in [`packages/core/src/llm/registry/index.test.ts`](../../../packages/core/src/llm/registry/index.test.ts); standalone generated-file assertions and low-signal consumer smoke checks were removed.
- Task 1 removed the old snapshot path `packages/core/src/llm/providers.generated.ts` in favor of [`packages/core/src/llm/registry/providers.generated.ts`](../../../packages/core/src/llm/registry/providers.generated.ts).
- Task 1 focused test files:
  - [`packages/core/src/llm/registry/index.test.ts`](../../../packages/core/src/llm/registry/index.test.ts)
  - [`packages/core/src/utils/api-key-resolver.test.ts`](../../../packages/core/src/utils/api-key-resolver.test.ts)
- Task 1 focused test command: `pnpm exec vitest run packages/core/src/llm/registry/index.test.ts packages/core/src/utils/api-key-resolver.test.ts`
- Task 2 is complete and focused on runtime metadata inference plus early support gating, without doing the broader runtime/factory cleanup planned for later tasks.
- Task 2 changed files:
  - [`packages/core/src/llm/registry/provider-runtime.ts`](../../../packages/core/src/llm/registry/provider-runtime.ts)
  - [`packages/core/src/llm/registry/provider-runtime.test.ts`](../../../packages/core/src/llm/registry/provider-runtime.test.ts)
  - [`scripts/sync-llm-models.ts`](../../../scripts/sync-llm-models.ts)
  - [`packages/core/src/llm/registry/providers.generated.ts`](../../../packages/core/src/llm/registry/providers.generated.ts)
  - [`packages/core/src/llm/registry/index.ts`](../../../packages/core/src/llm/registry/index.ts)
  - [`packages/core/src/llm/registry/index.test.ts`](../../../packages/core/src/llm/registry/index.test.ts)
  - [`packages/core/src/llm/schemas.ts`](../../../packages/core/src/llm/schemas.ts)
  - [`packages/core/src/llm/schemas.test.ts`](../../../packages/core/src/llm/schemas.test.ts)
  - [`packages/core/src/llm/services/factory.ts`](../../../packages/core/src/llm/services/factory.ts)
  - [`packages/core/src/llm/errors.ts`](../../../packages/core/src/llm/errors.ts)
  - [`packages/server/src/hono/routes/llm.ts`](../../../packages/server/src/hono/routes/llm.ts)
- Task 2 outcomes:
  - runtime family/category inference now lives in a small shared helper instead of only inside the generation script
  - `getSupportedProviders()` now returns runtime-supported providers rather than the full raw catalog
  - unsupported providers are rejected in `LLMConfigSchema` / `LLMUpdatesSchema` before model construction
  - `createVercelModel()` now defensively rejects unsupported providers even if a caller bypasses schema validation
  - server provider/model picker loops now use the runtime-supported provider list rather than the full raw catalog
- Task 2 verification:
  - focused tests: `pnpm exec vitest run packages/core/src/llm/registry/provider-runtime.test.ts packages/core/src/llm/registry/index.test.ts packages/core/src/llm/schemas.test.ts packages/core/src/llm/reasoning/profile.test.ts`
  - targeted typecheck: `pnpm exec tsc -p packages/core/tsconfig.json --noEmit && pnpm exec tsc -p packages/server/tsconfig.json --noEmit`
- Task 2 landed in commit `c9c1d994b` (`infer llm provider runtime metadata and gate support`).
- Task 2.5 exists because some user-facing selectors still iterate raw `LLM_PROVIDERS`, which can surface unsupported providers even though validation now rejects them.
- Likely Task 2.5 touch points:
  - [`packages/webui/components/AgentEditor/form-sections/LLMConfigSection.tsx`](../../../packages/webui/components/AgentEditor/form-sections/LLMConfigSection.tsx)
  - [`packages/webui/components/AgentEditor/FormEditorTabs.tsx`](../../../packages/webui/components/AgentEditor/FormEditorTabs.tsx)
  - [`packages/webui/components/AgentSelector/CreateAgentModal.tsx`](../../../packages/webui/components/AgentSelector/CreateAgentModal.tsx)
  - [`packages/webui/components/ModelPicker/ModelPickerModal.tsx`](../../../packages/webui/components/ModelPicker/ModelPickerModal.tsx)
  - [`packages/cli/src/cli/utils/provider-setup.ts`](../../../packages/cli/src/cli/utils/provider-setup.ts)
- Task 2.5 implementation is limited to the real affected WebUI selectors; the audit showed the model picker already derives visible providers from the supported catalog payload and CLI setup already uses a curated provider registry.
- Task 2.5 changed files:
  - [`packages/webui/lib/llm/provider-select.ts`](../../../packages/webui/lib/llm/provider-select.ts)
  - [`packages/webui/lib/llm/provider-select.test.ts`](../../../packages/webui/lib/llm/provider-select.test.ts)
  - [`packages/webui/components/AgentEditor/form-sections/LLMConfigSection.tsx`](../../../packages/webui/components/AgentEditor/form-sections/LLMConfigSection.tsx)
  - [`packages/webui/components/AgentEditor/FormEditorTabs.tsx`](../../../packages/webui/components/AgentEditor/FormEditorTabs.tsx)
  - [`packages/webui/components/AgentSelector/CreateAgentModal.tsx`](../../../packages/webui/components/AgentSelector/CreateAgentModal.tsx)
- Task 2.5 outcomes:
  - the WebUI provider selectors now derive visible providers from the runtime-supported `/llm/catalog` response instead of iterating raw `LLM_PROVIDERS`
  - existing configs with an unsupported provider keep that current value visible as a temporary `(...Unsupported)` option instead of silently blanking the selection
  - no registry/support-gating semantics changed in core; this is UI contract alignment only
- Task 2.5 verification:
  - focused tests: `pnpm exec vitest run packages/webui/lib/llm/provider-select.test.ts`
  - targeted typecheck: `pnpm exec tsc -p packages/webui/tsconfig.json --noEmit`
- Task 2.5 landed in commit `63389ece8` (`align webui provider selectors with supported catalog`).
- Task 3 consolidates the OpenRouter-style gateway model-origin helpers that were previously split across registry transform logic and reasoning-specific OpenRouter helpers.
- Task 3 changed files:
  - [`packages/core/src/llm/registry/model-origin.ts`](../../../packages/core/src/llm/registry/model-origin.ts)
  - [`packages/core/src/llm/registry/model-origin.test.ts`](../../../packages/core/src/llm/registry/model-origin.test.ts)
  - [`packages/core/src/llm/registry/index.ts`](../../../packages/core/src/llm/registry/index.ts)
  - [`packages/core/src/llm/reasoning/profile.ts`](../../../packages/core/src/llm/reasoning/profile.ts)
  - [`packages/core/src/llm/executor/provider-options.ts`](../../../packages/core/src/llm/executor/provider-options.ts)
  - removed [`packages/core/src/llm/reasoning/profiles/openrouter.ts`](../../../packages/core/src/llm/reasoning/profiles/openrouter.ts)
  - removed [`packages/core/src/llm/reasoning/profiles/openrouter.test.ts`](../../../packages/core/src/llm/reasoning/profiles/openrouter.test.ts)
- Task 3 outcomes:
  - OpenRouter-style gateway-provider detection, gateway semantic-origin resolution, and forward candidate generation now live in one small helper file under `registry/`
  - reasoning now routes gateway semantic reuse through that shared helper instead of a separate OpenRouter-only module
  - the existing safe fallback remains: unknown or intentionally unsupported gateway mappings still return non-capable reasoning semantics instead of guessed behavior
- Task 3 verification:
  - focused tests: `pnpm exec vitest run packages/core/src/llm/registry/model-origin.test.ts packages/core/src/llm/registry/index.test.ts packages/core/src/llm/reasoning/profile.test.ts`
  - targeted typecheck: `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`
- Task 3 landed in commit `0bbb8fa07` (`consolidate gateway model-origin helpers`).
- Task 4 adds explicit `ReasoningProfile.status` values so Dexto can distinguish supported semantics from known unsupported cases and unknown gateway semantics without guessing runtime controls.
- Task 4 changed files:
  - [`packages/core/src/llm/registry/index.ts`](../../../packages/core/src/llm/registry/index.ts)
  - [`packages/core/src/llm/formatters/vercel.ts`](../../../packages/core/src/llm/formatters/vercel.ts)
  - [`packages/core/src/llm/reasoning/profiles/shared.ts`](../../../packages/core/src/llm/reasoning/profiles/shared.ts)
  - [`packages/core/src/llm/reasoning/profile.ts`](../../../packages/core/src/llm/reasoning/profile.ts)
  - [`packages/core/src/llm/reasoning/profile.test.ts`](../../../packages/core/src/llm/reasoning/profile.test.ts)
  - [`packages/core/src/llm/executor/provider-options.test.ts`](../../../packages/core/src/llm/executor/provider-options.test.ts)
  - [`packages/server/src/hono/routes/llm.ts`](../../../packages/server/src/hono/routes/llm.ts)
  - [`packages/server/src/hono/__tests__/api.integration.test.ts`](../../../packages/server/src/hono/__tests__/api.integration.test.ts)
  - [`packages/cli/src/cli/commands/setup.test.ts`](../../../packages/cli/src/cli/commands/setup.test.ts)
- Task 4 outcomes:
  - `ReasoningProfile` now carries `status: 'supported' | 'unsupported' | 'unknown'` while preserving the existing `capable` execution gate
  - unresolved `openrouter` / `dexto-nova` semantics now report `status: 'unknown'` instead of being conflated with known unsupported models
  - provider-option generation still refuses to guess reasoning controls for unknown gateway semantics
  - shared OpenRouter-family gateway checks now reuse the existing `isOpenRouterGatewayProvider()` helper in core paths that actually share the same semantics, instead of repeating raw provider string comparisons
  - `/api/llm/capabilities` now exposes the status field alongside the existing reasoning metadata
- Task 4 verification:
  - focused tests: `pnpm exec vitest run packages/core/src/llm/reasoning/profile.test.ts packages/core/src/llm/executor/provider-options.test.ts packages/server/src/hono/__tests__/api.integration.test.ts`
  - targeted typecheck: `pnpm exec tsc -p packages/core/tsconfig.json --noEmit && pnpm exec tsc -p packages/cli/tsconfig.json --noEmit`
  - public-type refresh for downstream server checks: `pnpm --filter @dexto/core build && pnpm exec tsc -p packages/server/tsconfig.json --noEmit`
- Task 4 landed in commit `6e4393ead` (`roll out llm reasoning status reporting`).
- Task 5 introduces provider-grouped auth definitions in `agent-management` and keeps the lightweight method kinds intentionally simple.
- Task 5 changed files:
  - [`packages/agent-management/src/auth/provider-auth-definitions.ts`](../../../packages/agent-management/src/auth/provider-auth-definitions.ts)
  - [`packages/agent-management/src/auth/provider-auth-definitions.test.ts`](../../../packages/agent-management/src/auth/provider-auth-definitions.test.ts)
  - [`packages/agent-management/src/auth/connect-catalog.ts`](../../../packages/agent-management/src/auth/connect-catalog.ts)
  - [`packages/agent-management/src/index.ts`](../../../packages/agent-management/src/index.ts)
- Task 5 outcomes:
  - `ProviderAuthDefinition` / `AuthMethodDefinition` is now the source of truth for `/connect` provider-method metadata
  - `CONNECT_PROVIDERS` is now a derived view, so the lightweight `/connect` catalog no longer owns its own parallel provider/method definitions
  - `api_key`, `token`, and `guidance` methods stay lightweight; OAuth-specific behavior only exists on OAuth methods
  - stored auth profiles still resolve through the new definition surface using the existing `(providerId, methodId)` persistence model
- Task 6 moves the provider-specific OAuth protocol modules out of the CLI and makes runtime auth resolution definition-driven.
- Task 6 changed files:
  - [`packages/agent-management/src/auth/oauth/openai-codex.ts`](../../../packages/agent-management/src/auth/oauth/openai-codex.ts)
  - [`packages/agent-management/src/auth/oauth/openai-codex.test.ts`](../../../packages/agent-management/src/auth/oauth/openai-codex.test.ts)
  - [`packages/agent-management/src/auth/oauth/minimax-portal.ts`](../../../packages/agent-management/src/auth/oauth/minimax-portal.ts)
  - [`packages/agent-management/src/auth/oauth/minimax-portal.test.ts`](../../../packages/agent-management/src/auth/oauth/minimax-portal.test.ts)
  - [`packages/agent-management/src/auth/oauth/shared.ts`](../../../packages/agent-management/src/auth/oauth/shared.ts)
  - [`packages/agent-management/src/auth/runtime-auth-resolver.ts`](../../../packages/agent-management/src/auth/runtime-auth-resolver.ts)
  - [`packages/agent-management/src/auth/runtime-auth-resolver.test.ts`](../../../packages/agent-management/src/auth/runtime-auth-resolver.test.ts)
  - [`packages/cli/src/cli/commands/connect/index.ts`](../../../packages/cli/src/cli/commands/connect/index.ts)
  - [`packages/cli/src/cli/commands/connect/index.test.ts`](../../../packages/cli/src/cli/commands/connect/index.test.ts)
  - removed [`packages/cli/src/cli/commands/connect/openai-codex.ts`](../../../packages/cli/src/cli/commands/connect/openai-codex.ts)
  - removed [`packages/cli/src/cli/commands/connect/openai-codex.test.ts`](../../../packages/cli/src/cli/commands/connect/openai-codex.test.ts)
  - removed [`packages/cli/src/cli/commands/connect/minimax-portal.ts`](../../../packages/cli/src/cli/commands/connect/minimax-portal.ts)
  - removed [`packages/cli/src/cli/commands/connect/minimax-portal.test.ts`](../../../packages/cli/src/cli/commands/connect/minimax-portal.test.ts)
  - removed [`packages/cli/src/cli/commands/connect/oauth-error.ts`](../../../packages/cli/src/cli/commands/connect/oauth-error.ts)
- Task 6 outcomes:
  - OpenAI Codex and MiniMax Portal OAuth ownership now lives in `agent-management`, alongside the auth-definition surface that selects those methods
  - `createDefaultLlmAuthResolver()` now delegates OAuth refresh/runtime projection through auth definitions instead of hardcoded provider branches
  - the CLI `connect` flow still owns prompts/spinners/browser opening, but now starts OAuth via shared auth-definition hooks instead of importing provider-specific protocol modules directly
  - Task 7 still remains: the CLI is not yet fully driven by auth definitions end to end, only the OAuth implementation ownership moved here
- Task 5 / Task 6 focused verification:
  - focused tests: `pnpm exec vitest run packages/agent-management/src/auth/provider-auth-definitions.test.ts packages/agent-management/src/auth/oauth/openai-codex.test.ts packages/agent-management/src/auth/oauth/minimax-portal.test.ts packages/agent-management/src/auth/runtime-auth-resolver.test.ts packages/cli/src/cli/commands/connect/index.test.ts`
  - targeted typecheck: `pnpm exec tsc -p packages/agent-management/tsconfig.json --noEmit && pnpm exec tsc -p packages/server/tsconfig.json --noEmit`
  - downstream export refresh for CLI consumers: `pnpm --filter @dexto/agent-management build`
  - package-wide `packages/cli` typecheck still has unrelated pre-existing failures outside the connect slice; the touched `connect/index.ts` path is clean under filtered checking
  - repo quality gate: `bash scripts/quality-checks.sh`
- Task 7 finishes the CLI `/connect` cleanup on top of the shared auth definition surface.
- Task 7 changed files:
  - [`packages/cli/src/cli/commands/connect/index.ts`](../../../packages/cli/src/cli/commands/connect/index.ts)
  - [`packages/cli/src/cli/commands/connect/index.test.ts`](../../../packages/cli/src/cli/commands/connect/index.test.ts)
  - [`packages/cli/src/cli/commands/connect/index.integration.test.ts`](../../../packages/cli/src/cli/commands/connect/index.integration.test.ts)
- Task 7 outcomes:
  - the CLI provider picker now uses the real `ProviderAuthDefinition` surface directly instead of driving `/connect` off the derived `CONNECT_PROVIDERS` view
  - method selection, persistence, and OAuth start flow now operate on the selected auth-definition method object directly, reducing extra lookup drift inside the CLI
  - the CLI still owns prompts, spinners, browser opening, and replace/delete/default UX, which keeps Task 7 aligned with the intended ownership split
  - a focused integration-style test now proves that a profile connected through `/connect` still resolves into compatible runtime auth for a representative OAuth-backed provider
- Task 7 verification:
  - focused tests: `pnpm exec vitest run packages/cli/src/cli/commands/connect/index.test.ts packages/cli/src/cli/commands/connect/index.integration.test.ts packages/agent-management/src/auth/runtime-auth-resolver.test.ts`
  - targeted downstream checks: `pnpm exec tsc -p packages/agent-management/tsconfig.json --noEmit && pnpm exec tsc -p packages/server/tsconfig.json --noEmit`
  - touched-file CLI typecheck check: `pnpm exec tsc -p packages/cli/tsconfig.json --noEmit --pretty false 2>&1 | rg "packages/cli/src/cli/commands/connect/index(\\.integration)?\\.test\\.ts|packages/cli/src/cli/commands/connect/index\\.ts"`
  - repo quality gate: `bash scripts/quality-checks.sh`

---

## Key Decisions


| Date       | Decision                                                                                                                                                                                                                             | Reasoning                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-02 | Keep models.dev provider IDs as-is for phase 1, including region/plan variants.                                                                                                                                                      | Minimizes churn and keeps Dexto aligned with upstream provider identity for now.                                                                                                             |
| 2026-04-02 | Keep `/connect` aligned with runtime provider IDs.                                                                                                                                                                                   | Reduces mental and implementation mismatch between connect flow and runtime config.                                                                                                          |
| 2026-04-02 | Extend `ProviderInfo` rather than adding a new provider-definition registry first.                                                                                                                                                   | Reuses the existing registry surface and avoids a second provider source of truth.                                                                                                           |
| 2026-04-02 | Keep `reasoning/` as the main semantics layer.                                                                                                                                                                                       | Existing reasoning logic is already meaningful; a large parallel abstraction is not needed yet.                                                                                              |
| 2026-04-02 | Keep model-origin logic as plain helper functions.                                                                                                                                                                                   | Current needs are stateless and table-driven; no dedicated abstraction is justified yet.                                                                                                     |
| 2026-04-02 | Add `status` directly to `ReasoningProfile` using `supported`, `unsupported`, and `unknown`.                                                                                                                                        | This keeps the semantic distinction explicit without inventing a second reasoning-capability contract.                                                                                       |
| 2026-04-02 | Auth definitions stay explicit by `(providerId, methodId)` and may reuse a tiny shared implementation layer underneath.                                                                                                              | Preserves provider-specific behavior while allowing minimal reuse for generic mechanics.                                                                                                     |
| 2026-04-02 | Provider runtime metadata should be derived automatically at build time for generated providers.                                                                                                                                     | Avoids hand-maintaining 100+ providers while still allowing a tiny override layer for Dexto-specific or exceptional cases.                                                                   |
| 2026-04-02 | The generated provider snapshot should be app-oriented rather than preserving a separate raw upstream snapshot in-repo.                                                                                                              | The purpose of the generated files is to serve Dexto directly; raw upstream data can be re-fetched from models.dev when needed.                                                              |
| 2026-04-02 | `runtime.family` should reflect Dexto runtime semantics rather than just mirroring raw upstream `npm` strings.                                                                                                                       | The family is meant to describe how Dexto actually executes requests; all current implemented cases should be audited before locking the final enum.                                         |
| 2026-04-02 | Support gating should be family-first with a small exception layer.                                                                                                                                                                  | This keeps enablement scalable as more providers are added without hand-maintaining every provider individually.                                                                             |
| 2026-04-02 | `ReasoningProfile.status === 'unknown'` should preserve the current safe runtime fallback behavior.                                                                                                                                  | The goal is semantic clarity, not making runtime behavior more speculative.                                                                                                                  |
| 2026-04-02 | Providers can share a runtime family while remaining distinct providers.                                                                                                                                                             | Runtime family is secondary metadata for execution and validation, not a replacement for provider identity.                                                                                  |
| 2026-04-02 | `runtime.category` should use `direct`, `gateway`, `cloud`, `self-hosted`, and `local`.                                                                                                                                              | This is a simple, readable categorization that matches the current Dexto surface well.                                                                                                       |
| 2026-04-02 | Runtime-family naming should align with `pi-mono`'s technical API names where that maps cleanly.                                                                                                                                     | Keeping internal family names closer to `pi-mono` should make future comparison and reuse easier.                                                                                            |
| 2026-04-02 | Generated runtime metadata should include only structural identity (`runtime.family`, `runtime.category`), while support gating remains separate and Dexto-owned.                                                                    | Family/category inference is build-time structural metadata; enablement changes independently and should not be baked into the generated snapshot.                                           |
| 2026-04-02 | `openrouter` should remain its own runtime family in phase 1, and `dexto-nova` should align with it.                                                                                                                                 | They already use an OpenRouter-specific SDK path and have gateway-specific reasoning/model-origin behavior, so forcing them into `openai-completions` too early would hide real differences. |
| 2026-04-02 | Do not add a second generated runtime metadata field in phase 1.                                                                                                                                                                     | A few extra families are simpler than introducing another metadata dimension before it is clearly needed.                                                                                    |
| 2026-04-02 | Use one explicit auth provider-method surface keyed by `(providerId, methodId)`.                                                                                                                                                     | This gives Dexto a clear extension contract for multi-method providers without requiring a larger plugin framework.                                                                          |
| 2026-04-02 | Keep auth reuse limited to small shared helpers, not a complex base-class system.                                                                                                                                                    | Provider-specific OAuth behavior still differs enough that inheritance-heavy abstractions would likely add churn rather than remove it.                                                      |
| 2026-04-02 | Keep core as the runtime execution surface, with auth behavior configured via injection; `/connect` and `switchLLM` should be treated as one end-to-end flow.                                                                        | `switchLLM` already exists in core, CLI already calls it, and runtime auth resolution is already injected into core execution.                                                               |
| 2026-04-02 | `google-vertex-anthropic` should remain its own runtime family in phase 1.                                                                                                                                                           | It is a genuine hybrid path with Vertex runtime semantics and Anthropic-style reasoning semantics, so collapsing it too early would blur real behavior.                                      |
| 2026-04-02 | `cohere` should remain its own runtime family in phase 1.                                                                                                                                                                            | Dexto uses a dedicated Cohere SDK path today, and there is not yet a strong enough case to collapse it into another shared family.                                                           |
| 2026-04-02 | Use Option A for the auth method object shape: provider-grouped definitions with OAuth-specific nested hooks only for OAuth methods.                                                                                                 | This keeps the contract explicit and extensible without introducing generic acquire/runtime buckets before they are needed.                                                                  |
| 2026-04-02 | Phase 1 runtime families are: `openai-responses`, `openai-completions`, `anthropic-messages`, `google-generative-ai`, `google-vertex`, `google-vertex-anthropic`, `bedrock-converse-stream`, `openrouter`, `cohere`, `local-native`. | This is the smallest family set that matches the current code paths while preserving the hybrid cases that would otherwise require a second metadata field.                                  |


---

## Open Questions / Blockers

- None blocking.
- `PLAN.md` has been finalized; this file now serves as historical context for the alignment process.

---

## Completed Tasks


| Date       | Task                                                  | Notes                                                                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-02 | Created initial v2 discussion docs                    | Added `grill-me-discussion.md`, WIP `PLAN.md`, and this working-memory file to track alignment.                                                                                                                                                                                  |
| 2026-04-02 | Completed `/grill-me` alignment for the v2 direction  | Locked the runtime-family direction, auth definition shape, ownership split, and reasoning-status direction.                                                                                                                                                                     |
| 2026-04-02 | Completed Task 1 registry runtime metadata foundation | Moved the generated provider snapshot under `registry/`, wired `ProviderInfo.runtime` from the generated snapshot, regenerated provider metadata with initial runtime fields, removed unnecessary widening casts added during the task, and kept focused registry coverage only. |
| 2026-04-03 | Completed Task 2 runtime metadata inference and support gating | Added a shared runtime-metadata inference helper, regenerated provider runtime metadata from it, introduced family-first provider support gating with clear unsupported-provider reasons, rejected unsupported providers earlier in schemas/runtime creation, and filtered server provider/model picker loops to runtime-supported providers. |
| 2026-04-03 | Completed Task 2.5 runtime-supported provider list alignment | Switched the affected WebUI provider selectors to use the runtime-supported catalog surface, kept legacy unsupported current values visible as temporary unsupported options during edit flows, and committed the slice as its own follow-up task. |
| 2026-04-03 | Completed Task 3 gateway model-origin consolidation | Consolidated the OpenRouter-style gateway origin helpers under `registry/model-origin.ts`, reused that helper from both the registry transform path and the reasoning path, removed the old OpenRouter-specific reasoning helper module, and committed the slice as `0bbb8fa07`. |
| 2026-04-03 | Completed Task 4 reasoning status rollout | Added `status` to `ReasoningProfile`, preserved the safe unknown-gateway fallback, exposed the new status via `/api/llm/capabilities`, reused the existing OpenRouter-family helper for shared gateway checks, and committed the slice as `6e4393ead`. |
