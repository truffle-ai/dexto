# Working Memory - V2 Provider/Auth/Reasoning Refactor

> **This file is a live scratchpad for the v2 design/alignment process.**
> Read it before continuing the discussion. Update it as decisions become clearer.

---

## How to use this file

1. Read the "Current Task" section before continuing work.
2. Update the "Key Decisions" table whenever a design branch becomes aligned.
3. Add unresolved items to "Open Questions / Blockers".
4. Keep [`grill-me-discussion.md`](./grill-me-discussion.md) as the more detailed discussion log.
5. Once the major open questions are resolved, finalize [`PLAN.md`](./PLAN.md) and use this file mainly as historical context.

---

## Current Task

**Task:** Finalize the v2 provider/auth/reasoning refactor plan after design alignment
**Status:** _Completed_

### Plan

- record the last aligned decisions in `grill-me-discussion.md`
- rewrite/finalize `PLAN.md`
- keep this file as a compact record of the final alignment state

### Notes

- The current repo already has real structure in `packages/core/src/llm`; the main problem is branch sprawl and mixed responsibilities.
- The current safe runtime behavior for unknown reasoning semantics is already mostly correct; the main missing piece is distinguishing `unknown` from `unsupported`.
- Generated provider IDs and provider metadata already come from `sync-llm-models.ts` plus a small Dexto overlay.

---

## Key Decisions

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-02 | Keep models.dev provider IDs as-is for phase 1, including region/plan variants. | Minimizes churn and keeps Dexto aligned with upstream provider identity for now. |
| 2026-04-02 | Keep `/connect` aligned with runtime provider IDs. | Reduces mental and implementation mismatch between connect flow and runtime config. |
| 2026-04-02 | Extend `ProviderInfo` rather than adding a new provider-definition registry first. | Reuses the existing registry surface and avoids a second provider source of truth. |
| 2026-04-02 | Keep `reasoning/` as the main semantics layer. | Existing reasoning logic is already meaningful; a large parallel abstraction is not needed yet. |
| 2026-04-02 | Keep model-origin logic as plain helper functions. | Current needs are stateless and table-driven; no dedicated abstraction is justified yet. |
| 2026-04-02 | Add `status` directly to `ReasoningProfile` using `supported | unsupported | unknown`. | Keeps the type surface simple while distinguishing unknown semantics from known unsupported cases. |
| 2026-04-02 | Auth definitions stay explicit by `(providerId, methodId)` and may reuse a tiny shared implementation layer underneath. | Preserves provider-specific behavior while allowing minimal reuse for generic mechanics. |
| 2026-04-02 | Provider runtime metadata should be derived automatically at build time for generated providers. | Avoids hand-maintaining 100+ providers while still allowing a tiny override layer for Dexto-specific or exceptional cases. |
| 2026-04-02 | The generated provider snapshot should be app-oriented rather than preserving a separate raw upstream snapshot in-repo. | The purpose of the generated files is to serve Dexto directly; raw upstream data can be re-fetched from models.dev when needed. |
| 2026-04-02 | `runtime.family` should reflect Dexto runtime semantics rather than just mirroring raw upstream `npm` strings. | The family is meant to describe how Dexto actually executes requests; all current implemented cases should be audited before locking the final enum. |
| 2026-04-02 | Support gating should be family-first with a small exception layer. | This keeps enablement scalable as more providers are added without hand-maintaining every provider individually. |
| 2026-04-02 | `ReasoningProfile.status === 'unknown'` should preserve the current safe runtime fallback behavior. | The goal is semantic clarity, not making runtime behavior more speculative. |
| 2026-04-02 | Providers can share a runtime family while remaining distinct providers. | Runtime family is secondary metadata for execution and validation, not a replacement for provider identity. |
| 2026-04-02 | `runtime.category` should use `direct`, `gateway`, `cloud`, `self-hosted`, and `local`. | This is a simple, readable categorization that matches the current Dexto surface well. |
| 2026-04-02 | Runtime-family naming should align with `pi-mono`'s technical API names where that maps cleanly. | Keeping internal family names closer to `pi-mono` should make future comparison and reuse easier. |
| 2026-04-02 | Generated runtime metadata should include only structural identity (`runtime.family`, `runtime.category`), while support gating remains separate and Dexto-owned. | Family/category inference is build-time structural metadata; enablement changes independently and should not be baked into the generated snapshot. |
| 2026-04-02 | `openrouter` should remain its own runtime family in phase 1, and `dexto-nova` should align with it. | They already use an OpenRouter-specific SDK path and have gateway-specific reasoning/model-origin behavior, so forcing them into `openai-completions` too early would hide real differences. |
| 2026-04-02 | Do not add a second generated runtime metadata field in phase 1. | A few extra families are simpler than introducing another metadata dimension before it is clearly needed. |
| 2026-04-02 | Use one explicit auth provider-method surface keyed by `(providerId, methodId)`. | This gives Dexto a clear extension contract for multi-method providers without requiring a larger plugin framework. |
| 2026-04-02 | Keep auth reuse limited to small shared helpers, not a complex base-class system. | Provider-specific OAuth behavior still differs enough that inheritance-heavy abstractions would likely add churn rather than remove it. |
| 2026-04-02 | Keep core as the runtime execution surface, with auth behavior configured via injection; `/connect` and `switchLLM` should be treated as one end-to-end flow. | `switchLLM` already exists in core, CLI already calls it, and runtime auth resolution is already injected into core execution. |
| 2026-04-02 | `google-vertex-anthropic` should remain its own runtime family in phase 1. | It is a genuine hybrid path with Vertex runtime semantics and Anthropic-style reasoning semantics, so collapsing it too early would blur real behavior. |
| 2026-04-02 | `cohere` should remain its own runtime family in phase 1. | Dexto uses a dedicated Cohere SDK path today, and there is not yet a strong enough case to collapse it into another shared family. |
| 2026-04-02 | Use Option A for the auth method object shape: provider-grouped definitions with OAuth-specific nested hooks only for OAuth methods. | This keeps the contract explicit and extensible without introducing generic acquire/runtime buckets before they are needed. |
| 2026-04-02 | Phase 1 runtime families are: `openai-responses`, `openai-completions`, `anthropic-messages`, `google-generative-ai`, `google-vertex`, `google-vertex-anthropic`, `bedrock-converse-stream`, `openrouter`, `cohere`, `local-native`. | This is the smallest family set that matches the current code paths while preserving the hybrid cases that would otherwise require a second metadata field. |

---

## Open Questions / Blockers

- None blocking.
- `PLAN.md` has been finalized; this file now serves as historical context for the alignment process.

---

## Completed Tasks

| Date | Task | Notes |
|------|------|-------|
| 2026-04-02 | Created initial v2 discussion docs | Added `grill-me-discussion.md`, WIP `PLAN.md`, and this working-memory file to track alignment. |
| 2026-04-02 | Completed `/grill-me` alignment for the v2 direction | Locked the runtime-family direction, auth definition shape, ownership split, and reasoning-status direction. |
