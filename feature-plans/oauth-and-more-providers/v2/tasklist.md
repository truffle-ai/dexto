# Task List - V2 Provider/Auth/Reasoning Refactor

Derived from the finalized [`PLAN.md`](./PLAN.md).

This task list is intentionally medium-grained:

- each task should land as a coherent set of changes
- each task includes focused tests
- tasks are sequenced, but not so rigid that minor implementation deviations become painful

Use this as execution guidance, not as a hard waterfall. If a task uncovers a design issue, update the plan/docs rather than forcing the implementation to match stale assumptions.

---

## Task Shaping Rules

- Keep tasks large enough to deliver a visible simplification, not just move a symbol from one file to another.
- Keep tasks small enough that they can be reviewed and tested without requiring the entire refactor to land first.
- Prefer preserving current behavior within each task unless the task explicitly changes behavior.
- Add targeted tests near the behavior being changed. Avoid broad low-signal tests that only restate the implementation.
- Do not introduce extra abstraction layers unless the task proves they are needed.

---

## Task 1. Registry Runtime Metadata Foundation

### Changes

- Move the generated provider snapshot into `packages/core/src/llm/registry/providers.generated.ts`.
- Update imports/consumers so provider snapshot access is registry-centered.
- Add `runtime.family` and `runtime.category` to the generated provider metadata shape and the `ProviderInfo` surface.
- Keep the initial wiring simple; this task is mainly about establishing the data path and location.

### Tests

- Add or update sync/generation tests or snapshots that verify the generated provider output shape.
- Add registry tests for representative providers showing `runtime.family` / `runtime.category` are exposed correctly.
- Add a smoke-style regression test for any consumer that imports provider metadata from the new location.

### Notes

- This task should not yet try to solve support gating, reasoning status, or auth-definition refactors.

---

## Task 2. Runtime Metadata Inference and Support Gating

### Changes

- Infer `runtime.family` and `runtime.category` during `sync-llm-models.ts` using:
  - current implemented Dexto runtime paths
  - models.dev `provider.npm` where the inference is clean
  - a tiny local override layer for Dexto-specific providers and real exceptions
- Add the phase 1 runtime-family mapping from the finalized plan.
- Add family-first support gating plus a small exception layer.
- Reject unsupported providers/families earlier in validation instead of failing only in model construction.

### Tests

- Add inference tests for representative providers in each runtime family.
- Add regression tests for the special families:
  - `openrouter`
  - `dexto-nova`
  - `google-vertex-anthropic`
  - `cohere`
- Add validation tests showing supported providers pass and unsupported providers fail early with useful errors.

### Notes

- Keep the gating model intentionally simple. Do not add a second generated runtime metadata field in this task.

---

## Task 3. Gateway Model-Origin Consolidation

### Changes

- Add `packages/core/src/llm/registry/model-origin.ts`.
- Move or consolidate gateway/proxy semantic mapping logic there.
- Route OpenRouter-style model-origin lookups through that helper from reasoning/capability code.
- Preserve the current safe behavior for unknown mappings.

### Tests

- Add model-origin helper tests for representative mappings:
  - Anthropic family naming differences
  - Gemini naming differences
  - unknown/unmapped gateway models
- Add regression tests showing `openrouter` / `dexto-nova` still reuse upstream semantics where intended.
- Add a regression test showing unknown gateway models still fall back safely.

### Notes

- Keep this helper stateless in phase 1.
- Do not turn this into a large plugin/adapter layer.

---

## Task 4. Reasoning Status Rollout

### Changes

- Add `status` to `ReasoningProfile` with:
  - `supported`
  - `unsupported`
  - `unknown`
- Update reasoning capability/reporting paths to preserve the distinction.
- Keep current runtime behavior for unknown semantics:
  - allow execution
  - avoid guessed reasoning controls
- Update server schema/response surfaces if they expose reasoning capability data.

### Tests

- Add reasoning profile unit tests for:
  - supported native providers
  - known unsupported cases
  - unknown gateway semantics
- Add provider-options regression tests proving unknown semantics do not emit guessed reasoning params.
- Add server/schema tests if `/llm/capabilities` or related responses now expose `status`.

### Notes

- This task is about semantic clarity, not inventing a new runtime fallback.

---

## Task 5. Auth Definition Surface Foundation

### Changes

- Introduce the provider-grouped `ProviderAuthDefinition` / `AuthMethodDefinition` surface in `agent-management`.
- Keep `api_key`, `token`, and `guidance` lightweight.
- Keep the phase 1 persistence model simple:
  - method-specific extras remain in `credential.metadata`
  - no typed per-method persisted schemas
- Start routing catalog lookups through the new definition surface while preserving current behavior.

### Tests

- Add definition lookup/shape tests for representative providers and methods.
- Add compatibility tests showing stored profile behavior remains valid with the new definition layer.
- Add focused tests for the lightweight method kinds (`api_key`, `token`, `guidance`) so they do not accidentally inherit OAuth complexity.

### Notes

- This task should establish the contract, not fully migrate all OAuth behavior yet.

---

## Task 6. OAuth Method Ownership Move

### Changes

- Move provider-specific OAuth protocol modules from the CLI into `agent-management`.
- Implement OAuth-specific nested hooks:
  - `oauth.start(...)`
  - `oauth.refresh(...)`
  - `oauth.resolveRuntimeAuth(...)`
- Refactor runtime auth resolution to delegate through auth definitions instead of hardcoded provider/method branches where possible.
- Keep existing runtime behavior intact for:
  - OpenAI Codex OAuth
  - MiniMax Portal OAuth

### Tests

- Move/update existing OpenAI Codex and MiniMax OAuth module tests.
- Add runtime-auth-resolver tests for:
  - refresh behavior
  - runtime auth projection
  - provider-specific metadata usage such as `accountId`, `region`, `resourceUrl`, and `clientId`
- Add regression tests that multiple OAuth-backed provider variants still resolve correctly.

### Notes

- Avoid building a generic OAuth engine while doing this task.
- Shared helpers are fine, but only for clearly repeated mechanics.

---

## Task 7. CLI `/connect` on Top of Auth Definitions

### Changes

- Refactor `packages/cli/src/cli/commands/connect/index.ts` to drive the new auth definition surface.
- Keep CLI ownership of:
  - prompts
  - spinners
  - browser opening
  - replace/delete/default UX
- Preserve existing connect behavior while removing hardcoded provider/method branching from the CLI where the auth definitions can own it.
- Ensure the resulting stored profiles continue to align with the existing `switchLLM` + injected auth-resolver path.

### Tests

- Update CLI connect command tests for provider/method selection through the new surface.
- Add regression tests for replace/delete/default flows.
- Add a focused integration-style test showing that a connected profile still produces compatible runtime auth resolution for a representative provider.

### Notes

- This task should make the CLI thinner, not smarter.

---

## Task 8. Runtime Hotspot Cleanup in `factory.ts` and `provider-options.ts`

### Changes

- Extract only the highest-value family-specific hotspots from:
  - `packages/core/src/llm/services/factory.ts`
  - `packages/core/src/llm/executor/provider-options.ts`
- Start with the branch clusters that are already painful, rather than splitting every runtime family into its own file.
- Keep the runtime-family direction visible in code without turning it into a blanket adapter framework.

### Tests

- Add or update factory routing tests for representative providers across the phase 1 families.
- Add provider-options regression tests for representative reasoning/control translation cases:
  - OpenAI
  - Anthropic
  - Google
  - Bedrock
  - OpenRouter/gateway
- Add focused tests around runtime auth overrides if the extracted helpers touch OAuth-backed providers.

### Notes

- This task is complete when the worst branch density is reduced, not when every branch disappears.

---

## Task 9. Final Integration and Cleanup Pass

### Changes

- Audit that the finalized runtime-family mapping, auth definitions, and reasoning status all line up across:
  - core registry
  - reasoning
  - runtime auth
  - CLI `/connect`
  - server capability/catalog surfaces
- Remove obsolete branching and comments left over from pre-v2 paths.
- Update docs if implementation revealed a real design deviation.

### Tests

- Add or update regression tests for the main end-to-end aligned paths:
  - connected auth profile -> runtime auth resolution -> model construction
  - gateway model -> origin mapping -> reasoning capability behavior
  - unsupported provider/family -> early validation failure
- Run the relevant targeted test suites for all touched areas.

### Notes

- This is the cleanup/integration task, not a place to introduce new abstractions.

---

## Suggested Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9

This order keeps the data model and support gating stable before the auth/connect refactor gets deeper, and keeps the branch-cleanup work after the new metadata/auth surfaces exist.
