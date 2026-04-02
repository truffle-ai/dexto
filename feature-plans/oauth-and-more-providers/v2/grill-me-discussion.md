# Grill-Me Discussion - V2 Provider/Auth/Reasoning Refactor

Date started: **2026-04-02**

This file is a running log of the design discussion for the v2 provider/auth/reasoning plan.
It is intentionally discussion-oriented rather than polished.

Use this file to capture:

- the exact question being discussed
- the user's answer or preference
- the current recommendation
- whether the topic is aligned, open, or needs follow-up

When all major open questions are resolved, rewrite and finalize [`PLAN.md`](./PLAN.md).

Related files:

- [`PLAN.md`](./PLAN.md)
- [`WORKING_MEMORY.md`](./WORKING_MEMORY.md)
- [`ARCHITECTURE_FLOW.md`](./ARCHITECTURE_FLOW.md)
- [`PROPOSED_MODULE_TREE.md`](./PROPOSED_MODULE_TREE.md)

---

## Current Position

The current direction is:

- keep models.dev provider IDs as-is for phase 1, including region/plan variants that come from models.dev
- keep `/connect` aligned with runtime provider IDs
- extend the existing registry/provider metadata rather than introduce a brand-new provider-definition registry immediately
- keep `reasoning/` as the main semantics layer
- keep model-origin logic as helper functions rather than a class/abstraction
- distinguish reasoning `unknown` from `unsupported`
- use minimal shared scaffolding for auth methods, but avoid over-abstraction

---

## Decisions Log

### Provider Identity And Registry

#### Q1. Should region/plan variants remain separate in phase 1?

Context:

- models.dev includes provider IDs like `minimax-cn`, `minimax-coding-plan`, `moonshotai-cn`, `zhipuai-coding-plan`, `zai-coding-plan`, `kimi-for-coding`
- collapsing these into higher-level abstractions would reduce provider count, but would also move Dexto away from models.dev IDs

User answer:

- Keep them separate in phase 1 if they come from models.dev.
- Do not collapse them yet just to create a cleaner abstraction.

Current recommendation:

- Keep models.dev provider IDs as-is for phase 1.
- Revisit collapsing or aliasing only if the branchiness becomes genuinely painful later.

Status: **Aligned**

#### Q2. Should `/connect` use the same provider IDs as runtime config?

Context:

- `/connect` could have its own curated provider identity layer, or it could directly target runtime provider IDs

User answer:

- Yes, keep `/connect` aligned with runtime provider IDs.

Current recommendation:

- Yes. `/connect` should target runtime provider IDs directly.

Status: **Aligned**

#### Q3. Should we extend `ProviderInfo` or introduce a new provider-definition registry first?

Context:

- `packages/core/src/llm/registry/index.ts` already has `ProviderInfo`
- a new provider-definition abstraction could eventually exist, but it adds another source of truth

User answer:

- `ProviderInfo` is probably better for now.

Current recommendation:

- Extend `ProviderInfo` first.
- Only split later if it becomes too large or too conceptually overloaded.

Status: **Aligned**

#### Q4. Should provider runtime metadata be derived automatically for generated providers?

Context:

- there are 100+ providers in the generated snapshot
- manually maintaining runtime metadata for all of them would be too much churn

User answer:

- Yes.
- Generated providers should get this automatically.
- Only Dexto-added providers and true exceptions should need local maintenance.

Current recommendation:

- Generate runtime metadata automatically at build time.
- Keep only a tiny local override layer for Dexto overlay providers and genuine exceptions.

Status: **Aligned**

#### Q5. Where should those runtime fields live conceptually?

Context:

- we want fields like runtime family and provider category
- these are Dexto runtime semantics, not raw models.dev facts

User answer:

- Store them on provider metadata, but derive them automatically rather than hand-maintain them per provider.

Current recommendation:

- Add a nested `runtime` object to provider metadata.
- Derive it during `sync-llm-models`.

Status: **Aligned in principle**

Open nuance:

- whether the generated runtime metadata should live directly inside `ProviderSnapshotEntry` in `providers.generated.ts`
- or in a separate generated map consumed by the registry builder

### Reasoning

#### Q6. Should Dexto distinguish reasoning `unknown` vs `unsupported`?

Context:

- current code usually falls back to `nonCapableProfile()` when it cannot confidently infer reasoning semantics
- this keeps runtime safe, but it conflates "we know this is unsupported" with "we do not know enough"

User answer:

- Yes, `unknown` vs `unsupported` is useful and should not be too hard.

Current recommendation:

- Add `status` directly to `ReasoningProfile`.
- Use exactly `supported | unsupported | unknown`.

Status: **Aligned**

#### Q7. Should this be a new wrapper type around `ReasoningProfile`?

Context:

- we could wrap the profile in another result type, or add the field directly

User answer:

- Add status directly. No need for wrappers.

Current recommendation:

- Add `status` directly to `ReasoningProfile`.

Status: **Aligned**

#### Q8. What should happen for a random OpenRouter model whose reasoning semantics are unclear?

Context:

- some gateway models may advertise reasoning support in a broad sense without exposing a paradigm Dexto can safely map

User answer:

- Use `unknown` for this case.

Current recommendation:

- Let the model run.
- Do not guess reasoning params.
- Mark the model as `unknown` instead of `unsupported`.

Status: **Aligned**

### Abstractions And Module Shape

#### Q9. Should we add a heavyweight API-family abstraction now?

Context:

- there is branching in `factory.ts`, `provider-options.ts`, and `reasoning/profile.ts`
- one option is a larger family-runtime system
- another is smaller helper extraction only where needed

User answer:

- Avoid heavyweight abstraction unless the sprawl really demands it.
- If logic is split too much, a shared abstraction can make sense later.

Current recommendation:

- Do not create a heavyweight API-family framework yet.
- Use small helper extraction only where branch density is already painful.

Status: **Aligned**

#### Q10. Should model-origin become a dedicated abstraction?

Context:

- gateway and proxy models sometimes need mapping back to upstream model families

User answer:

- A dedicated abstraction feels unnecessary right now.

Current recommendation:

- Keep model-origin logic as plain helper functions.
- Revisit only if state, injection, multiple implementations, or extension points become necessary.

Status: **Aligned**

#### Q11. When do abstractions make sense?

Context:

- some abstractions are useful because they define an external extension surface
- others just add naming overhead

User answer:

- Abstractions are good when they simplify and define external surfaces.
- They are unnecessary when plain functions would do.

Current recommendation:

- Prefer plain functions for stateless internal logic.
- Introduce explicit abstractions when there is a real extension surface, multiple implementations, shared state, or dependency injection need.

Status: **Aligned**

### Auth / Connect Method Structure

#### Q12. Where should state-management and flow logic live?

Context:

- auth flows touch persistence, refresh, protocol, and CLI/TUI UX

User answer:

- State-management belongs in `agent-management`.
- Connect UX belongs in CLI/TUI.

Current recommendation:

- Keep persistence, refresh, and protocol/state logic in `agent-management`.
- Keep prompts and interactive UX in CLI/TUI.

Status: **Aligned**

#### Q13. Should auth methods be fully bespoke per provider, or have tiny shared implementations underneath?

Context:

- some method mechanics are generic (`api_key`, `token`, generic OAuth device-code scaffolding)
- but provider-method behavior still differs

User answer:

- Use the shared-underneath approach only if it stays minimal and avoids over-abstraction.

Current recommendation:

- Public definitions stay explicit by `(providerId, methodId)`.
- Underneath, allow a tiny shared implementation layer for only a few reusable mechanics:
  - `api_key`
  - `static_token`
  - `oauth_device_code`
  - `guidance`

Status: **Aligned**

Open nuance:

- exact shape of the provider-method definition object
- exact boundary between shared OAuth scaffolding and provider-specific behavior

### Generated Runtime Metadata And Support Gating

#### Q21. Should Dexto keep a separate raw upstream provider snapshot, or should the generated snapshot be app-oriented?

Context:

- generated provider snapshots currently come from `sync-llm-models.ts`
- one option is to keep a raw upstream-like snapshot plus a second Dexto-oriented interpretation layer
- another option is to make the generated snapshot directly serve Dexto's needs

User answer:

- The generated files should serve Dexto itself.
- We do not need to preserve a separate raw upstream snapshot in the repo.
- If we need raw upstream data later, we can query models.dev directly.

Current recommendation:

- Keep a single generated provider snapshot oriented around Dexto's needs.
- Add Dexto runtime metadata into that generated snapshot rather than preserving a separate raw-only snapshot.

Status: **Aligned**

#### Q22. Should Dexto reject unsupported providers/families during validation and progressively enable them over time?

Context:

- generated providers may outnumber what Dexto actually executes today
- allowing unsupported providers through config and failing only in runtime model creation leads to worse UX

User answer:

- Yes.
- Dexto can progressively enable them over time.

Current recommendation:

- Reject unsupported providers/families early in validation.
- Track support in a way that allows gradual expansion over time.

Status: **Aligned in principle**

Open nuance:

- whether support should be tracked per provider, per runtime family, or by a family-first rule plus exceptions

#### Q23. Should `runtime.family` represent Dexto's actual request/runtime semantics rather than just mirroring raw `npm` package strings?

Context:

- generated providers include upstream `npm` hints from models.dev
- Dexto sometimes uses those directly, but sometimes its actual runtime behavior differs

Examples:

- `openai` in Dexto uses the Responses API, not just a generic OpenAI package label
- many providers marked `@ai-sdk/openai-compatible` should collapse to a shared Dexto runtime family
- `dexto-nova` is an especially important case where Dexto runtime semantics matter more than the raw package hint

User answer:

- Yes.
- Audit all existing implemented cases to verify the mapping.

Current recommendation:

- `runtime.family` should represent Dexto runtime semantics, not just raw `npm` labels.
- Before finalizing the enum and mappings, audit all currently implemented execution paths in:
  - `packages/core/src/llm/services/factory.ts`
  - `packages/core/src/llm/executor/provider-options.ts`
  - `packages/core/src/llm/reasoning/profile.ts`

Status: **Aligned**

#### Q24. Should `runtime.category` default to `direct`, with only the smaller set of gateway/cloud/local/self-hosted cases explicitly classified differently?

Context:

- most generated providers are ordinary direct providers
- the special categories are the minority

User answer:

- Yes, that probably makes sense.

Current recommendation:

- Default to `direct`.
- Explicitly classify the smaller set of special cases.

Status: **Tentatively aligned**

#### Q25. Should support gating be family-first, with a small exception layer, rather than fully hand-maintained per provider?

Context:

- generated providers already outnumber what Dexto fully executes today
- gating only at the provider level would create more maintenance churn

User answer:

- Yes.

Current recommendation:

- Prefer family-first support gating with a small exception layer where needed.

Status: **Aligned**

#### Q26. What should the initial runtime-family naming direction be?

Context:

- family names should reflect Dexto runtime semantics
- user specifically preferred `openai-responses` and `openai-chat`

User answer:

- `openai-responses`
- `openai-chat`
- the rest looked reasonable, but should be verified against the current code paths

Current recommendation:

- Use `openai-responses` and `openai-chat` as the direction.
- Audit the rest of the currently implemented cases before locking the full enum.

Status: **Partially aligned**

Open nuance:

- exact full runtime-family enum
- whether some families need a second field for option/request namespace rather than overloading family alone

#### Q27. What should the initial provider-category direction be?

Context:

- provider category is a higher-level role like direct, gateway, cloud, self-hosted, or local

User answer:

- The proposed categories looked fine.

Current recommendation:

- Proceed with:
  - `direct`
  - `gateway`
  - `cloud`
  - `self-hosted`
  - `local`

Status: **Aligned**

#### Q28. When `ReasoningProfile.status === 'unknown'`, should we preserve the current safe runtime behavior by keeping the profile effectively non-capable?

Context:

- the runtime today is already safe for unknown semantics
- the main design change is adding semantic clarity, not changing the fallback behavior

User answer:

- Yes.

Current recommendation:

- Preserve the current safe runtime behavior:
  - keep the profile effectively non-capable for control purposes
  - add `status: 'unknown'` to distinguish it from known unsupported cases

Status: **Aligned**

#### Q29. Should `runtime.family` stay as the high-level execution family, with a second narrower field only if the audit proves family alone is not enough?

Context:

- one metadata field is simpler
- but some providers may share a broad family while differing in request or provider-options namespace details

User answer:

- Yes.

Current recommendation:

- Keep `runtime.family` as the high-level execution family.
- Add a second narrower field only if the audit proves it is necessary.

Status: **Aligned**

#### Q30. If multiple providers share one runtime family, do they still remain distinct providers?

Context:

- family metadata should not collapse provider identity
- examples include many OpenAI-like providers that may share one request family while remaining separate providers in config and `/connect`

User answer:

- Yes.
- Same family is fine as long as providers remain distinct.
- Individual audits are still required.

Current recommendation:

- Providers remain distinct.
- `runtime.family` is secondary metadata, not a replacement for provider identity.

Status: **Aligned**

#### Q31. What should we do with providers like `groq`, `xai`, and `cohere` when deciding runtime-family grouping?

Context:

- current Dexto implementation uses dedicated SDK constructors for `groq`, `xai`, and `cohere`
- `pi-mono` explicitly separates provider from API family, and maps several providers into shared APIs where the request shape is effectively the same

Pi findings:

- `pi-mono` maps `groq` -> `openai-completions`
- `pi-mono` maps `xai` -> `openai-completions`
- `pi-mono` also maps other providers like `zai` and `openrouter` into `openai-completions`
- `pi-mono` does not provide a strong direct-cohere analogue in the same way

User answer:

- Check `pi-mono`.

Current recommendation:

- Use `pi-mono` as a reference point, not an exact constraint.
- Treat `groq` and `xai` as strong candidates for a shared OpenAI-like runtime family after audit.
- Keep `cohere` open for now unless the Dexto audit shows it cleanly belongs in an existing shared family.

Status: **Open / needs one more pass**

#### Q32. Should the initial provider-category mapping be:

- `direct`
- `gateway`
- `cloud`
- `self-hosted`
- `local`

Context:

- provider category is a higher-level role, separate from runtime family
- the proposed default is `direct`, with only smaller special sets explicitly classified otherwise

User answer:

- Yes.
- Check `pi-mono` as a sanity check.

Current recommendation:

- Proceed with those categories.
- Use `pi-mono` as a sanity check, but keep the categories Dexto-owned.

Status: **Aligned**

#### Q33. Should Dexto align runtime-family naming with `pi-mono`'s technical API names where possible?

Context:

- `pi-mono` uses technical API names like:
  - `openai-completions`
  - `openai-responses`
  - `anthropic-messages`
  - `bedrock-converse-stream`
  - `google-generative-ai`
  - `google-vertex`
- earlier discussion also considered slightly more Dexto-facing names like `openai-chat`

User answer:

- `pi-mono`-style names are fine.
- Keeping internal naming closer to theirs may help future reference.
- For families unique to Dexto, we can choose our own names.

Current recommendation:

- Align runtime-family naming with `pi-mono` where it maps cleanly.
- Use Dexto-specific names only where `pi-mono` has no good equivalent or where Dexto runtime semantics materially differ.

Status: **Aligned**

#### Q34. Should `groq` and `xai` likely join the shared OpenAI-like family after audit, while `cohere` remains open for now?

Context:

- `pi-mono` maps both `groq` and `xai` to `openai-completions`
- Dexto currently uses dedicated SDK constructors for `groq`, `xai`, and `cohere`

User answer:

- Yes.

Current recommendation:

- Treat `groq` and `xai` as strong candidates for the shared OpenAI-like family after final audit.
- Keep `cohere` separate for now unless the Dexto runtime audit shows a clearer shared fit.

Status: **Aligned**

#### Q35. Should support gating be implemented as generated `runtime.family` plus a Dexto-owned enabled-family set and small exception layer?

Context:

- generated provider metadata can tell us what family a provider belongs to
- Dexto still needs a smaller notion of what is actually enabled/supported today

User answer:

- Yes.

Current recommendation:

- Use generated `runtime.family`.
- Maintain a smaller Dexto-owned enabled-family set.
- Add provider-specific exceptions only when needed.

Status: **Aligned**

#### Q36. Should generated runtime metadata initially include only `runtime.family` and `runtime.category`, while support gating remains separate rather than stored as `implemented` or `enabled` in the generated snapshot?

Context:

- support enablement changes at a different pace than build-time family/category inference
- mixing them into one generated field can make the snapshot less stable and less reusable

User answer:

- Yes.

Current recommendation:

- Keep generated runtime metadata limited to structural identity:
  - `runtime.family`
  - `runtime.category`
- Keep enablement/support gating separate and Dexto-owned.

Status: **Aligned**

#### Q37. What should Dexto do about `openrouter` and `dexto-nova` in the runtime-family enum?

Context:

- many providers can be grouped into shared families cleanly
- `openrouter` and `dexto-nova` are less clean because:
  - they use the OpenRouter provider path in `factory.ts`
  - gateway reasoning/model-origin logic already treats them specially
  - `dexto-nova` is effectively Dexto's OpenRouter-backed gateway

User answer:

- Shared families are still good overall.
- `openrouter` may reasonably be its own family.
- `dexto-nova` should align with `openrouter`.
- Keeping them separate may make sense because they use their own Vercel AI SDK implementation.

Current recommendation:

- Keep `openrouter` as its own runtime family for phase 1.
- Map `dexto-nova` to that same family.
- Do not force them into `openai-completions` yet.

Status: **Aligned**

#### Q38. Does Dexto need a second generated runtime metadata field beyond `runtime.family` in phase 1?

Context:

- some hybrid providers could justify another field later
- but adding more generated metadata too early risks overfitting the current code

User answer:

- Prefer avoiding that for now.
- Add more families if needed instead.

Current recommendation:

- Do not add a second generated runtime metadata field in phase 1.
- Prefer adding a few extra runtime families over introducing another metadata dimension prematurely.

Status: **Aligned**

#### Q39. What should the auth provider-method definition surface look like?

Context:

- current auth logic is split across:
  - `connect-catalog.ts`
  - CLI `/connect` flow branching
  - `runtime-auth-resolver.ts`
- user explicitly wanted a clear contract for adding multi-method providers

User answer:

- Agrees with a single explicit method-definition surface.

Current recommendation:

- Define one explicit provider-method surface keyed by `(providerId, methodId)`.
- Let it own:
  - display metadata (`label`, `kind`, `hint`)
  - connect/acquisition behavior
  - refresh behavior, if any
  - runtime auth projection, if any

Status: **Aligned**

#### Q40. How much shared auth abstraction should Dexto introduce?

Context:

- current provider-specific modules like `openai-codex.ts` and `minimax-portal.ts` are already fairly self-contained
- the risk is over-designing a generic OAuth engine or base class system

User answer:

- Shared helpers are fine.
- No complex base class style abstraction.
- Let each module implement itself and call shared helpers where useful.

Current recommendation:

- Keep shared auth abstraction intentionally small.
- Use helper functions/factories for obvious shared mechanics.
- Keep provider-specific OAuth protocol logic in dedicated modules.
- Do not introduce a complex inheritance-style abstraction in phase 1.

Status: **Aligned**

#### Q41. What is the concrete ownership split across CLI, agent-management, and core, including `switchLLM`?

Context:

- earlier discussion already aligned on:
  - state-management in `agent-management`
  - connect UX in CLI/TUI
- user also reminded that `/connect` should fit the eventual flow where CLI model switching and provider switching work together cleanly

Verification pass:

- `DextoAgent.switchLLM(...)` already exists in core
- CLI mode setup already calls `agent.switchLLM(...)`
- runtime auth is already injected into core via `llmAuthResolver` and resolved at execution time by provider/model

User answer:

- Yes.
- Core should remain the actual runtime/execution behavior surface, configurable via injection.
- `/connect` and model switching should line up cleanly.

Current recommendation:

- `agent-management` owns:
  - auth method definitions
  - profile persistence/defaults
  - OAuth protocol helpers
  - token refresh logic
  - runtime auth projection
- CLI/TUI owns:
  - prompts
  - spinners
  - browser opening
  - replace/delete/default UX
- core owns:
  - actual runtime execution behavior
  - auth consumption via injected resolver
  - `switchLLM` behavior and session/application of validated config
- treat `/connect` and `switchLLM` as parts of one end-to-end flow, not separate systems

Status: **Aligned**

#### Q42. What should Dexto do with `google-vertex-anthropic` in the runtime-family enum?

Context:

- `google-vertex-anthropic` is a hybrid path:
  - it uses a dedicated Vertex Anthropic SDK constructor in `factory.ts`
  - it uses Vertex auth/project/location semantics
  - its reasoning behavior is Anthropic-style
- forcing it into either `google-vertex` or `anthropic-messages` would hide one side of that reality

User answer:

- Yes, keep it separate.

Current recommendation:

- Give `google-vertex-anthropic` its own runtime family in phase 1.
- Avoid collapsing it into `google-vertex` or `anthropic-messages` until a stronger reason appears.

Status: **Aligned**

#### Q43. What should Dexto do with `cohere` in the runtime-family enum?

Context:

- Dexto currently uses a dedicated Cohere SDK constructor
- unlike `groq` and `xai`, we did not find as strong a case for collapsing it into the shared OpenAI-like family

User answer:

- Sure.

Current recommendation:

- Keep `cohere` as its own runtime family in phase 1.

Status: **Aligned**

#### Q44. What exact auth provider-method object shape should the rewritten plan use?

Context:

- we already aligned on:
  - one explicit auth surface keyed by `(providerId, methodId)`
  - minimal shared helpers
  - no heavy base-class or generic plugin system
- the remaining question was whether the method object should use:
  - generic acquire/runtime buckets
  - or OAuth-specific nested hooks only where OAuth actually needs them

User answer:

- Option A.
- Keep OAuth-specific nested hooks.

Current recommendation:

- Use a provider-grouped auth definition surface:
  - `providerId`
  - `label`
  - optional `modelsDevProviderId`
  - `methods`
- Make `methods` a discriminated union by `kind`.
- Keep `api_key`, `token`, and `guidance` lightweight.
- Only `oauth` methods get nested OAuth-specific hooks, e.g.:
  - `oauth.start(...)`
  - `oauth.refresh(...)`
  - `oauth.resolveRuntimeAuth(...)`
- Keep persisted method-specific extras in the existing `credential.metadata` string map for phase 1 rather than introducing typed per-method stored schemas.

Status: **Aligned**

#### Final recommended phase 1 `runtime.family` enum

Synthesis from the audit plus aligned decisions:

- `openai-responses`
- `openai-completions`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`
- `google-vertex-anthropic`
- `bedrock-converse-stream`
- `openrouter`
- `cohere`
- `local-native`

---

## Open Questions

- No remaining blocking design questions.
- `PLAN.md` has now been rewritten/finalized from this discussion.

---

## Next Discussion Branch

The next step should be:

1. Use the finalized `PLAN.md` as the source of truth for the implementation phase
2. Update supporting v2 docs only when the design direction itself changes
3. Move from alignment into implementation work when ready
