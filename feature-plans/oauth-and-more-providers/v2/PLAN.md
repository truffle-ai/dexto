# V2 Provider/Auth/Reasoning Refactor Plan

> Finalized after the `/grill-me` design-alignment discussion.

Supporting docs:

- [`WORKING_MEMORY.md`](./WORKING_MEMORY.md)
- [`grill-me-discussion.md`](./grill-me-discussion.md)
- [`ARCHITECTURE_FLOW.md`](./ARCHITECTURE_FLOW.md)
- [`PROPOSED_MODULE_TREE.md`](./PROPOSED_MODULE_TREE.md)
- [`../PLAN.md`](../PLAN.md)
- [`../UPDATED_DIRECTION.md`](../UPDATED_DIRECTION.md)

---

## 1. Problem

The repo already has real structure for provider execution, auth, and reasoning, but the decision logic is spread across too many places:

- `packages/core/src/llm/services/factory.ts`
- `packages/core/src/llm/executor/provider-options.ts`
- `packages/core/src/llm/reasoning/profile.ts`
- `packages/core/src/llm/registry/index.ts`
- `packages/agent-management/src/auth/runtime-auth-resolver.ts`
- `packages/cli/src/cli/commands/connect/index.ts`

The main issue is not that Dexto lacks abstractions. The issue is that the current abstractions do not line up cleanly with the real responsibilities:

- provider identity vs runtime request family
- generated upstream metadata vs Dexto-owned runtime semantics
- reasoning capability semantics vs request-shape translation
- connect UX vs auth persistence/refresh/runtime projection

That creates branch sprawl in the places that matter most at runtime and in the CLI.

The goal of this v2 effort is to reduce that sprawl without introducing a large plugin system or abstract base-class hierarchy.

---

## 2. Goals

- Keep models.dev provider IDs as-is in phase 1, including region and plan variants.
- Keep `/connect` aligned with the real runtime provider IDs.
- Extend the existing `ProviderInfo`-style registry surface instead of adding a second provider registry immediately.
- Derive Dexto-owned runtime metadata automatically for generated providers.
- Keep `reasoning/` as the main semantics layer.
- Keep model-origin logic as plain helper functions.
- Give new provider auth methods a clear, explicit implementation contract.
- Keep `/connect` and `switchLLM` as parts of one end-to-end provider/auth flow.

---

## 3. Non-Goals

- Do not collapse models.dev region or plan variants in phase 1.
- Do not introduce a generic OAuth engine or inheritance-heavy auth framework.
- Do not add a second generated runtime metadata field in phase 1.
- Do not turn model-origin logic into a large standalone abstraction.
- Do not claim support for every generated provider on day 1; support remains gated separately.

---

## 4. Final Design Direction

### 4.1 Provider runtime metadata

Keep `ProviderInfo` as the main provider metadata surface, but add Dexto-owned runtime metadata to it during the generation step.

Phase 1 generated runtime metadata:

```ts
type RuntimeCategory = 'direct' | 'gateway' | 'cloud' | 'self-hosted' | 'local';

type RuntimeFamily =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'google-vertex'
  | 'google-vertex-anthropic'
  | 'bedrock-converse-stream'
  | 'openrouter'
  | 'cohere'
  | 'local-native';

type ProviderRuntimeMetadata = {
  family: RuntimeFamily;
  category: RuntimeCategory;
};
```

Key rules:

- `runtime.family` represents Dexto runtime semantics, not raw upstream `npm` labels.
- `runtime.category` is a higher-level role label. Most providers default to `direct`; only the smaller special sets are explicitly classified otherwise.
- Generated metadata stays app-oriented. We do not keep a separate raw upstream snapshot in-repo.
- Support gating is separate from generated metadata:
  - generated metadata says what a provider looks like
  - Dexto-owned gating says what is actually enabled today
- Support gating is family-first, with a small exception layer where needed.
- The generated provider snapshot should live alongside other registry snapshots under `packages/core/src/llm/registry/`.

How generation should work:

- Use the current implemented Dexto runtime paths as the primary truth for supported providers.
- Use models.dev metadata, especially `provider.npm`, to infer families for generated providers where that inference is clean.
- Apply only a tiny local override layer for Dexto-specific providers and real exceptions.

Phase 1 family mapping:

- `openai-responses`
  - `openai`
- `openai-completions`
  - `openai-compatible`
  - `zhipuai`
  - `zhipuai-coding-plan`
  - `zai`
  - `zai-coding-plan`
  - `moonshotai`
  - `moonshotai-cn`
  - `litellm`
  - `glama`
  - `ollama`
  - `groq`
  - `xai`
- `anthropic-messages`
  - `anthropic`
  - `minimax`
  - `minimax-cn`
  - `minimax-coding-plan`
  - `minimax-cn-coding-plan`
  - `kimi-for-coding`
- `google-generative-ai`
  - `google`
- `google-vertex`
  - `google-vertex`
- `google-vertex-anthropic`
  - `google-vertex-anthropic`
- `bedrock-converse-stream`
  - `amazon-bedrock`
- `openrouter`
  - `openrouter`
  - `dexto-nova`
- `cohere`
  - `cohere`
- `local-native`
  - `local`

Why the special families stay separate:

- `openrouter` stays separate because it already uses a dedicated SDK path and gateway-specific reasoning/model-origin logic. `dexto-nova` aligns with that same family.
- `google-vertex-anthropic` stays separate because it is a genuine hybrid: Vertex runtime semantics with Anthropic-style reasoning semantics.
- `cohere` stays separate because the current Dexto path is a dedicated Cohere SDK implementation, and there is not yet a strong reason to collapse it into another shared family.

### 4.2 Reasoning

Keep `packages/core/src/llm/reasoning/` as the semantics layer.

Phase 1 reasoning direction:

- Add `status` directly to `ReasoningProfile`.
- Use:
  - `supported`
  - `unsupported`
  - `unknown`
- Preserve the current safe runtime behavior for unknown semantics:
  - allow the model to run
  - do not guess reasoning parameters
  - do not expose false precision in capability reporting
- Keep gateway model-origin logic as helper functions, especially for OpenRouter-style gateways.
- Keep `StreamProcessor` as the event/output normalization boundary.

This refactor is about clarifying semantics and reducing branch sprawl, not about replacing the existing reasoning layer.

### 4.3 Auth/connect definition surface

Keep the top-level provider-grouped structure because the CLI is provider-first, but make the method definitions explicit enough that one definition object owns the behavior for that `(providerId, methodId)` pair.

Phase 1 auth surface:

```ts
type ProviderAuthDefinition = {
  providerId: string;
  label: string;
  modelsDevProviderId?: string;
  methods: AuthMethodDefinition[];
};

type AuthMethodDefinition =
  | ApiKeyAuthMethodDefinition
  | TokenAuthMethodDefinition
  | GuidanceAuthMethodDefinition
  | OAuthAuthMethodDefinition;

type ApiKeyAuthMethodDefinition = {
  id: string;
  kind: 'api_key';
  label: string;
  hint?: string;
};

type TokenAuthMethodDefinition = {
  id: string;
  kind: 'token';
  label: string;
  hint?: string;
};

type GuidanceAuthMethodDefinition = {
  id: string;
  kind: 'guidance';
  label: string;
  hint?: string;
  docsUrl?: string;
};

type OAuthAuthMethodDefinition = {
  id: string;
  kind: 'oauth';
  label: string;
  hint?: string;
  oauth: {
    start(ctx: OAuthStartContext): Promise<OAuthStartResult>;
    refresh(ctx: OAuthRefreshContext): Promise<Extract<LlmAuthCredential, { type: 'oauth' }>>;
    resolveRuntimeAuth(ctx: OAuthRuntimeContext): LlmRuntimeAuthOverrides;
  };
};
```

Important constraints:

- Use a discriminated union by `kind`.
- Keep `api_key`, `token`, and `guidance` lightweight.
- Only `oauth` methods get nested OAuth-specific hooks.
- Do not introduce generic `acquire` / `runtime` buckets in phase 1.
- Keep persisted method-specific extras in the existing `credential.metadata` string map for phase 1.
- Do not introduce typed per-method persisted schemas yet.

Shared auth abstraction should stay intentionally small:

- shared helpers/factories for obvious common cases like `api_key`, `token`, and `guidance`
- provider-specific modules for OAuth protocol mechanics
- no base-class system
- no generic OAuth DSL

### 4.4 Ownership split

`agent-management` owns:

- auth method definitions
- profile persistence and defaults
- OAuth protocol helpers/modules
- token refresh logic
- runtime auth projection

CLI/TUI owns:

- provider and method selection UX
- prompts
- spinners
- browser opening
- replace/delete/default flows

core owns:

- actual runtime execution behavior
- `switchLLM`
- consumption of auth via injected resolver
- provider-family-specific execution behavior

Design implication:

- `/connect` is not a separate runtime path.
- `/connect` writes the auth/profile state that core later consumes through the injected resolver.
- model switching should continue to flow through the existing `switchLLM` path.

### 4.5 Runtime branch cleanup approach

Reduce branch density by introducing smaller helper modules where the branch sprawl is already painful, without creating a large adapter framework.

Phase 1 direction:

- keep `reasoning/` as the semantic layer
- keep `StreamProcessor` as-is
- keep model-origin as helper functions
- use `runtime.family` to drive helper extraction where it clearly improves structure
- prefer small family-oriented helpers over a giant class hierarchy

This means v2 should reduce the biggest switch/if clusters, but it does not need to eliminate every provider-specific branch in one pass.

---

## 5. Implementation Workstreams

### 5.1 Registry and generated metadata

- Move the generated provider snapshot under `packages/core/src/llm/registry/` alongside the model snapshot.
- Extend `sync-llm-models.ts` to emit `runtime.family` and `runtime.category`.
- Add the tiny local override map needed for Dexto-specific providers and true exceptions.
- Update registry consumers to read runtime metadata from the generated snapshot.
- Add family-first support gating plus a small exception layer.
- Reject unsupported providers/families earlier in validation instead of failing only in model construction.

### 5.2 Reasoning status and gateway semantics

- Add `status` to `ReasoningProfile`.
- Update capability/reporting surfaces to distinguish `unknown` from `unsupported`.
- Preserve the current safe runtime fallback for unknown semantics.
- Keep OpenRouter-style model-origin logic as helper functions and audit current gateway cases against the new family mapping.

### 5.3 Auth definition consolidation

- Replace the split between tiny connect metadata in `connect-catalog.ts`, CLI acquisition branching, and resolver branching with one explicit definition surface.
- Keep provider-specific OAuth protocol code in dedicated modules.
- Move persistence/refresh/runtime projection ownership fully into `agent-management`.
- Keep the CLI/TUI layer thin and UX-focused.

### 5.4 CLI and runtime integration

- Make `/connect` drive the new auth definitions rather than hardcoded provider/method branches.
- Keep existing runtime execution in core unchanged in principle: core still consumes an injected auth resolver.
- Ensure model switching continues to work through `switchLLM` with auth resolved lazily by provider/model at execution time.
- Keep providers not exposed in `/connect` usable via config/env when they are enabled by support gating.

### 5.5 Branch cleanup in execution paths

- Extract the worst family-specific branching from `factory.ts` into smaller helpers where it improves readability.
- Do the same for `provider-options.ts` where family-specific reasoning translation is already clustered.
- Avoid creating a parallel runtime abstraction layer unless the helper extraction still leaves unacceptable sprawl.

---

## 6. Expected End State

After this refactor:

- generated provider metadata clearly separates provider identity from Dexto runtime semantics
- supported providers are enabled intentionally rather than by accidental partial compatibility
- adding a new API-key or token method is mostly data plus a small helper
- adding a new OAuth method has one explicit place to define:
  - connection start behavior
  - refresh behavior
  - runtime auth projection
- `/connect`, profile persistence, runtime auth resolution, and `switchLLM` all align on the same provider/auth model
- reasoning capability reporting is clearer because `unknown` and `unsupported` are distinguished
- core runtime branching is smaller and more family-oriented without over-abstracting the system

---

## 7. Validation Notes

- Prefer focused tests around:
  - runtime-family inference and gating
  - auth definition behavior
  - OAuth refresh/runtime projection
  - reasoning `status` semantics
- Do not add broad fallback behavior just to preserve older branches.
- Phase 1 should favor correctness and explicitness over speculative compatibility.
