# Dexto Reasoning (Display + Tuning) - Implementation Plan v2

This plan supersedes `reasoning-plan.md` and updates it for the current (post-merge) codebase and
the direction of a models.dev-backed capability registry (see `~/Projects/dexto` on `models-dev`).

Goals:
- Reasoning is **displayed** (WebUI + CLI) when a provider/model emits it.
- Reasoning is **tunable** across providers (best-effort) without requiring users to understand
  provider-specific concepts like "budget tokens".
- Gateway/openai-compatible providers attempt reasoning control when upstream models support it.

Non-goals (for v2):
- Perfect parity of all provider quirks on day 1 (we want a safe best-effort baseline).
- Preserving backwards compatibility of old config fields (user explicitly said not required).

---

## 0) Terminology (disambiguate early)

Reasoning has two distinct axes:

1) **Reasoning output / display**
   - Do we receive "thoughts / thinking / reasoning" content from the provider?
   - Do we store it and show it to the user?

2) **Reasoning control / tuning**
   - Can we enable/disable reasoning mode?
   - Can we adjust "how hard it thinks" (effort levels, token budgets, etc.)?

Providers also split into two paradigms:

- **Effort-based** (OpenAI-style): `reasoning_effort` with discrete levels.
- **Budget-based** (Anthropic/Google-style): "thinking budget tokens".
- **Always-on / not configurable**: some models always produce reasoning or have no supported knob.

Finally, some openai-compatible models are **interleaved reasoning** models:

- “Interleaved” here means the model can emit reasoning in multiple blocks *between tool calls* (not just
  one up-front thinking blob). Some APIs require that you send those reasoning blocks back during the same
  turn as tool calling continues, so the model can keep “thinking between actions”.
- In OpenAI-compatible APIs this continuity is often represented by sending back a dedicated field
  like `reasoning_content` or `reasoning_details` (instead of only an AI-SDK `reasoning` content part).
- This is represented in models.dev as `interleaved: { field: "reasoning_content" | "reasoning_details" }`.
- See opencode’s implementation: `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts`.

---

## 1) Current State (what exists today)

### 1.1 Reasoning collection + persistence (Core)

We already:
- accumulate reasoning deltas from the AI SDK stream (`event.type === 'reasoning-delta'`)
- persist `AssistantMessage.reasoning` + `AssistantMessage.reasoningMetadata`

Code pointers:
- Reasoning collection and persistence:
  - `packages/core/src/llm/executor/stream-processor.ts:112-129`
  - `packages/core/src/llm/executor/stream-processor.ts:340-351`
- Reasoning round-trip into the next request (as an AI SDK "reasoning" part):
  - `packages/core/src/llm/formatters/vercel.ts:213-230`

Note: `feature-plans/context-calculation.md` includes an outdated claim that we do NOT persist
reasoning; that is no longer true after the merge.

### 1.2 Reasoning display (WebUI vs CLI)

WebUI:
- Displays reasoning in a collapsible panel when `msg.reasoning` is present.
  - `packages/webui/components/MessageList.tsx:682-742`
- Streams reasoning chunks via `llm:chunk` events (`chunkType === 'reasoning'`).
  - `packages/webui/lib/events/handlers.ts:109-139`

CLI:
- Does NOT display reasoning currently.
- Headless subscriber explicitly ignores reasoning chunks:
  - `packages/cli/src/cli/cli-subscriber.ts:24-31`
- Ink CLI stream handling ignores non-text chunks:
  - `packages/cli/src/cli/ink-cli/services/processStream.ts:358-419`
  - External-trigger streaming ignores non-text chunks:
    `packages/cli/src/cli/ink-cli/hooks/useAgentEvents.ts:364-367`

### 1.3 Reasoning tuning today (limited + inconsistent)

Today we only have a single tuning knob:
- `llm.reasoningEffort` (OpenAI only)
  - `packages/core/src/llm/schemas.ts:94-131`

And the providerOptions builder only applies OpenAI reasoning effort when `provider === 'openai'`:
- `packages/core/src/llm/executor/provider-options.ts:87-99`

Implication: OpenAI models routed via gateway providers (e.g. `openrouter`, `dexto`, `litellm`, etc.)
currently do NOT get reasoning-effort tuning, even when upstream supports it.

Also: the existing providerOptions builder appears to use some AI SDK keys incorrectly for Vertex/Bedrock.
This matters because AI SDK providerOptions are keyed by the SDK provider namespace, not Dexto’s provider.
(See Section 4.)

---

## 2) Desired UX (simple defaults + advanced escape hatch)

### 2.1 A unified reasoning config (what users set)

User-facing config should make reasoning usable without requiring people to know "budget tokens".

Proposed shape (conceptual):

```yaml
llm:
  reasoning:
    # A single primary knob: pick a reasoning preset.
    # This is provider/model dependent but should start from a familiar set:
    # auto | off | low | medium | high | max
    #
    # Some models may expose extra presets (e.g. OpenAI: minimal/xhigh).
    preset: medium

    # Advanced (optional):
    # Only needed for budget-based providers (Anthropic/Gemini-like), when you want an explicit token budget.
    # This should override the preset's derived budget.
    budgetTokens: 8192
```

Notes:
- `preset` is the simple abstraction and should be what most users touch.
- `budgetTokens` is the single advanced escape hatch (only for budget-based providers).
- If both `preset` and `budgetTokens` are set, `budgetTokens` wins.
- Reasoning *display* should not be part of agent config; treat it as a UI preference (WebUI/CLI).

No backwards compatibility required:
- We can remove/replace `llm.reasoningEffort` cleanly.

### 2.2 CLI interaction

We should support BOTH:
- Display reasoning output.
- Tuning (quick + deeper config).

Recommendation:
- Add a `/reasoning` interactive command to:
  - show current reasoning preset
  - show provider/model-resolved concrete settings (e.g. resolved budget or resolved effort)
  - cycle presets
  - optionally set an explicit `budgetTokens` if the user wants.

Important constraint:
- Tab/Shift+Tab are already heavily used in Ink CLI (`packages/cli/src/cli/ink-cli/hooks/useInputOrchestrator.ts`),
  so a Tab-based toggle is likely a conflict. Prefer slash-command-based toggles or a carefully chosen keybind.
  opencode uses `ctrl+t` for cycling model “variants” (including reasoning presets). For Dexto, `ctrl+t`
  looks like a viable candidate for “cycle reasoning preset” (but we should confirm it doesn’t
  conflict with existing Ink keybindings).

### 2.3 WebUI interaction

WebUI already displays reasoning. We should add:
- A lightweight session-level reasoning preset control (similar to other CLIs).
- An agent-level default in the Agent Editor (so reasoning can be saved into YAML config).

---

## 3) Capability-driven behavior (models.dev as source of truth)

We want to stop relying on string heuristics like `isReasoningCapableModel(model)` and instead rely on:
- model capabilities from models.dev (or from the dynamic registry work in `~/Projects/dexto`).

models.dev already exposes useful fields:
- `reasoning: boolean`
- `temperature: boolean` (parameter compatibility)
- `interleaved: { field: "reasoning_content" | "reasoning_details" } | boolean`
- `tool_call`, `structured_output`, modalities, token limits, etc.

Current gap:
- In `~/Projects/dexto`, registry sync already exists (`scripts/sync-llm-registry.ts`) but does not
  currently surface reasoning/interleaved into the generated registry types.

Plan:
1) Extend the models.dev-derived registry to carry reasoning + interleaved metadata.
2) Add a single helper in core, e.g.:
   - `getModelCapabilities(provider, model)` returns:
     - `reasoningOutput: { supported: boolean }`
     - `reasoningControl: { mode: 'effort'|'budget'|'none'|'unknown', ... }`
     - `interleaved: false | { field: 'reasoning_content'|'reasoning_details' }`
     - `supportsTemperatureWhenReasoning: boolean` (or a more general param-compat set)
3) Use that helper everywhere:
   - UI: show the right controls.
   - Core: generate providerOptions correctly and safely.
   - Formatter: apply interleaved transforms when needed.

Cross-repo reference (models-dev):
- Registry entry point: `~/Projects/dexto/packages/core/src/llm/registry/index.ts`
- Registry sync script: `~/Projects/dexto/scripts/sync-llm-registry.ts`

---

## 4) ProviderOptions: how it REALLY works (and why mapping matters)

### 4.1 Key rule

`providerOptions` is a map keyed by the AI SDK provider namespace that `parseProviderOptions()`
expects (e.g. `openai`, `anthropic`, `google`, `bedrock`, etc.).

It is NOT keyed by "Dexto provider name" in general.

Evidence (AI SDK source):
- OpenAI parses under `provider: 'openai'`:
  `~/Projects/external/ai/packages/openai/src/chat/openai-chat-language-model.ts`
- Anthropic parses under `provider: 'anthropic'`:
  `~/Projects/external/ai/packages/anthropic/src/anthropic-messages-language-model.ts`
- Google parses under `provider: 'google'` or `'vertex'` depending on provider config:
  `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts`
- Bedrock parses under `provider: 'bedrock'`:
  `~/Projects/external/ai/packages/amazon-bedrock/src/bedrock-chat-language-model.ts`

### 4.2 Why Dexto needs an explicit mapping layer

Dexto config providers (today) include gateway-ish entries:
`openrouter`, `dexto`, `litellm`, `glama`, `openai-compatible`, etc.

In `packages/core/src/llm/services/factory.ts`, many of these are implemented using the OpenAI
provider with a different `baseURL` (i.e., still `@ai-sdk/openai`).

Implications:
- If we keep using `@ai-sdk/openai` for openai-compatible endpoints, we can only use the OpenAI
  providerOptions schema, and we likely cannot pass through unknown fields needed for interleaved reasoning.
  (OpenAI chat conversion ignores "reasoning" content parts entirely:
   `~/Projects/external/ai/packages/openai/src/chat/convert-to-openai-chat-messages.ts`.)
- If we switch to `@ai-sdk/openai-compatible` for those endpoints, we can support:
  - body passthrough for unknown options
  - interleaved fields (e.g. `reasoning_content`) in providerOptions, like opencode does

### 4.3 Concrete mapping table (target)

We should explicitly define "how to write providerOptions" for each configured provider:

| Dexto provider | Underlying SDK provider package | providerOptions key we write | Notes |
|---|---|---|---|
| `openai` | `@ai-sdk/openai` | `openai` | supports `reasoningEffort` |
| `anthropic` | `@ai-sdk/anthropic` | `anthropic` | supports `thinking` + `sendReasoning` |
| `google` | `@ai-sdk/google` | `google` | supports `thinkingConfig` |
| `vertex` (Gemini) | `@ai-sdk/google-vertex` (uses Google internals) | `vertex` (fallback `google`) | AI SDK falls back to `google` if `vertex` isn’t present |
| `vertex` (Claude) | `@ai-sdk/google-vertex/anthropic` (wraps Anthropic internals) | `anthropic` | options are parsed by Anthropic internals |
| `bedrock` | `@ai-sdk/amazon-bedrock` | `bedrock` | reasoning config is `reasoningConfig` |
| `openai-compatible` | (recommend) `@ai-sdk/openai-compatible` | `openaiCompatible` | needed for passthrough + interleaved message fields |
| `openrouter` | (current: `@ai-sdk/openai` w/ baseURL) (recommend: `@openrouter/ai-sdk-provider`) | current: `openai` (recommend: `openrouter`) | current impl can’t use OpenRouter-specific request-body options |
| `dexto` | (current: `@ai-sdk/openai` w/ baseURL) (recommend: `@openrouter/ai-sdk-provider`) | current: `openai` (recommend: `openrouter`) | dexto gateway is an OpenRouter-style gateway (see `~/Projects/dexto-cloud`) |

Opencode reference for mapping by npm package:
- `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:11-40`
Notes on the opencode reference:
- opencode maps `@ai-sdk/google-vertex` -> `google` (not `vertex`) and relies on the AI SDK’s
  `vertex` -> `google` fallback when parsing options:
  - opencode: `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:11-40`
  - AI SDK: `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts:100-115`
- opencode’s `@ai-sdk/openai-compatible` providers often set `name: providerID` when creating the SDK
  provider, so the effective providerOptions “namespace” can be that provider ID instead of a single global key.
  (Dexto likely shouldn’t copy that exact pattern; better to keep a stable mapping layer.)

### 4.4 API surface choice matters: OpenAI “Responses” vs “Chat Completions”

OpenAI has two relevant API surfaces in the AI SDK:
- **Responses**: `createOpenAI()(modelId)` or `createOpenAI().responses(modelId)`
- **Chat Completions**: `createOpenAI().chat(modelId)`

Why it matters for reasoning:
- Presets may want to set additional OpenAI-specific knobs that are only present/meaningful in Responses
  (e.g. `reasoningSummary`, `textVerbosity`, `include: ['reasoning.encrypted_content']`).
  - `~/Projects/external/ai/packages/openai/src/responses/openai-responses-options.ts`
- “Interleaved reasoning” as `reasoning_content`/`reasoning_details` continuity fields is an
  OpenAI-compatible/gateway pattern, not the OpenAI native Responses wire format.

Current Dexto state:
- `openai`: uses `createOpenAI()(model)` which selects the Responses API by default.
  - `packages/core/src/llm/services/factory.ts:65-68`
- `openrouter` and `dexto`: currently use `createOpenAI(...).chat(model)` (OpenAI chat shim over a gateway baseURL).
  - `packages/core/src/llm/services/factory.ts:79-84`
  - `packages/core/src/llm/services/factory.ts:109-135`

Implication:
- For OpenRouter-style gateways (including Dexto gateway), we should treat them as their own providers
  (`@openrouter/ai-sdk-provider` or `@ai-sdk/openai-compatible`), so we can:
  - send the correct providerOptions namespace
  - support interleaved reasoning fields when the model requires it
  - support gateway-specific reasoning knobs

---

## 5) Reasoning control translation (preset -> providerOptions)

We need one core translator that:
- reads validated `llm.reasoning` config
- reads model capabilities
- emits providerOptions (correct key + correct fields) OR emits warnings when unsupported

### 5.1 Proposed translation rules

Inputs:
- `reasoning.preset`: auto | off | low | medium | high | max | ... (model/provider dependent)
- `reasoning.budgetTokens`: optional advanced override (budget-based providers only)
- model capabilities (reasoning supported? interleaved? param compatibility?)

Outputs:
- `providerOptions` object to pass to `streamText()`
- plus warnings (log once per run) when config is requested but unsupported.

Resolution precedence (recommended):
1) `budgetTokens` (explicit numeric override) when supported.
2) `preset` mapped to a provider/model-specific request body.
3) default behavior (`preset=auto`): do nothing unless the model/provider has a known safe default.

### 5.2 Provider-specific notes (AI SDK references)

OpenAI (effort-based):
- The AI SDK maps `openai.reasoningEffort` -> `reasoning_effort` request body field:
  `~/Projects/external/ai/packages/openai/src/chat/openai-chat-language-model.ts:150-175`
- The AI SDK removes unsupported params for reasoning models (temperature/topP/logprobs):
  `~/Projects/external/ai/packages/openai/src/chat/openai-chat-language-model.ts:179-220`
- OpenAI “Responses” API exposes additional knobs that are useful for presets:
  - `reasoningSummary`, `textVerbosity`, `include: ['reasoning.encrypted_content']`, etc.
  - `~/Projects/external/ai/packages/openai/src/responses/openai-responses-options.ts`

Anthropic (budget-based "thinking"):
- Provider option is `anthropic.thinking: { type: 'enabled'|'disabled', budgetTokens? }`:
  `~/Projects/external/ai/packages/anthropic/src/anthropic-messages-options.ts:61-101`
- When enabled, AI SDK includes `thinking: { type, budget_tokens }` in request body:
  `~/Projects/external/ai/packages/anthropic/src/anthropic-messages-language-model.ts` (see `isThinking` and request body build)

Google (budget-ish via thinkingConfig):
- Provider option is `google.thinkingConfig` and the AI SDK maps thoughts into `reasoning` parts:
  `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts:74-92` (providerOptionsName)
  `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts:160-190` (thinkingConfig sent)
  (see also thought -> reasoning part mapping in the same file around the `part.thought` handling)

Bedrock:
- The AI SDK uses `bedrock.reasoningConfig` (not `sendReasoning`):
  `~/Projects/external/ai/packages/amazon-bedrock/src/bedrock-chat-language-model.ts:176-240`

Vertex:
- Gemini: uses providerOptionsName `vertex` with fallback to `google`:
  `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts:74-92`
- Claude: is an Anthropic language model under the hood:
  `~/Projects/external/ai/packages/google-vertex/src/anthropic/google-vertex-anthropic-provider.ts`
  so options should be written under `anthropic`.

---

## 6) Interleaved reasoning (support plan)

### 6.1 What it is

Two related (but not identical) “interleaved” concepts exist in the wild:

1) **Interleaved thinking (behavioral):** the model can reason *between* tool calls in a single assistant turn.
2) **Interleaved reasoning (wire format / continuity requirement):** the API requires the client to send back
   the model’s prior reasoning blocks (often via a dedicated field like `reasoning_content` / `reasoning_details`)
   while tool calling continues, so the model can continue reasoning after tool results.

In this plan, “interleaved reasoning” refers to (2), because that’s what the models.dev capability metadata
is encoding via `interleaved.field`.

Important: this is primarily a concern for OpenAI-compatible / gateway-style chat APIs (including OpenRouter-style
gateways) where the model expects a `reasoning_content`/`reasoning_details` continuity field. It is NOT how OpenAI’s
native Responses API represents reasoning continuity.

models.dev expresses this capability, and opencode uses it to rewrite messages.

### 6.2 What we should do in Dexto

At message-formatting time (Vercel formatter), if `capabilities.interleaved.field` is set:
- For assistant messages:
  - extract reasoning text (from `AssistantMessage.reasoning` / existing "reasoning" parts)
  - remove reasoning parts from `content` (so the model doesn’t see them twice)
  - set `message.providerOptions.openaiCompatible[field] = reasoningText`

Opencode reference implementation:
- `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:125-170`

Note:
- This likely requires using `@ai-sdk/openai-compatible` for those endpoints, because `@ai-sdk/openai`
  chat message conversion ignores reasoning parts (and doesn’t support these extra message fields):
  `~/Projects/external/ai/packages/openai/src/chat/convert-to-openai-chat-messages.ts`.

---

## 7) Phased execution plan (recommended order)

Phase 0 - Align on registry/capabilities
- Decide: merge/port `~/Projects/dexto` `models-dev` registry approach into this repo, or implement a minimal
  capability layer locally first.
- Extend models.dev ingestion to include `reasoning` and `interleaved`.
- Add `getModelCapabilities()` helper used by Core + WebUI + CLI.

Phase 1 - New config + UI surfaces
- Replace `llm.reasoningEffort` with `llm.reasoning` schema.
- WebUI: add a "Reasoning preset" control that adapts to capabilities (effort-based vs budget-based vs none).
- CLI: add `/reasoning` command for preset selection + optional `budgetTokens`.

Phase 2 - ProviderOptions refactor (single source of truth)
- Replace `packages/core/src/llm/executor/provider-options.ts` with capability-driven translation:
  - correct providerOptions keys
  - correct per-provider option shapes
  - warnings for unsupported combinations
- Apply reasoning controls for gateway providers too (best-effort).

Phase 3 - Provider selection correctness (important for gateways)
- Decide where we must switch SDK providers to support required features:
  - `openai-compatible`: move to `@ai-sdk/openai-compatible` for passthrough + interleaved reasoning.
  - `openrouter`/`dexto`: consider `@openrouter/ai-sdk-provider` (or keep current if sufficient),
    based on what options we need to pass and whether passthrough is required.

Phase 4 - CLI reasoning display
- Ink CLI: handle `llm:chunk` with `chunkType === 'reasoning'` and display it (UI design TBD).
- Headless CLI: decide whether to print reasoning by default or behind a flag/pref.

Phase 5 - Interleaved reasoning support
- Implement formatter-time transform (Section 6).
- Add regression tests mirroring opencode’s `transform.test.ts` cases (DeepSeek + tool calls).

Phase 6 - Clean-up / docs
- (Optional) Update/replace outdated notes in `feature-plans/context-calculation.md` about reasoning persistence.

---

## 8) Reference code pointers (Dexto)

Core execution pipeline:
- `packages/core/src/llm/services/vercel.ts` (TurnExecutor wiring)
- `packages/core/src/llm/executor/turn-executor.ts` (calls `streamText()`)
- `packages/core/src/llm/executor/stream-processor.ts` (reasoning collection/persistence)
- `packages/core/src/llm/formatters/vercel.ts` (reasoning round-trip + tool formatting)

Current providerOptions builder (to refactor):
- `packages/core/src/llm/executor/provider-options.ts`

Current config schema:
- `packages/core/src/llm/schemas.ts`

Current WebUI reasoning display:
- `packages/webui/components/MessageList.tsx`
- `packages/webui/lib/events/handlers.ts`

Current CLI behavior (missing reasoning display):
- `packages/cli/src/cli/cli-subscriber.ts`
- `packages/cli/src/cli/ink-cli/services/processStream.ts`
- `packages/cli/src/cli/ink-cli/hooks/useAgentEvents.ts`

---

## 9) Reference code pointers (External)

AI SDK:
- OpenAI reasoning effort + param compatibility warnings:
  - `~/Projects/external/ai/packages/openai/src/chat/openai-chat-language-model.ts`
- OpenAI provider naming (important: providerOptions key is still `openai` even if provider "name" changes):
  - `~/Projects/external/ai/packages/openai/src/openai-provider.ts`
- OpenAI chat conversion ignores reasoning parts (important for interleaved support decision):
  - `~/Projects/external/ai/packages/openai/src/chat/convert-to-openai-chat-messages.ts`
- OpenAI-compatible passthrough (unknown providerOptions keys become raw request-body fields):
  - `~/Projects/external/ai/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts`
- Anthropic thinking provider options:
  - `~/Projects/external/ai/packages/anthropic/src/anthropic-messages-options.ts`
- Google thinkingConfig and thought -> reasoning mapping:
  - `~/Projects/external/ai/packages/google/src/google-generative-ai-language-model.ts`
- Bedrock reasoningConfig:
  - `~/Projects/external/ai/packages/amazon-bedrock/src/bedrock-chat-language-model.ts`
- Vertex Anthropic wraps Anthropic internals:
  - `~/Projects/external/ai/packages/google-vertex/src/anthropic/google-vertex-anthropic-provider.ts`

Opencode:
- providerOptions key mapping by npm package + interleaved transform:
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts`

---

## 10) Appendix: Opencode Reasoning Flow (End-to-End)

This section is a detailed “how it works” write-up of opencode’s reasoning system, because it’s a
useful reference implementation for Dexto’s display + tuning goal.

### 10.1 Where opencode gets “reasoning capability” data

opencode’s model registry is models.dev-backed.

- models.dev schema includes:
  - `reasoning: boolean`
  - `interleaved?: true | { field: "reasoning_content" | "reasoning_details" }`
  - plus other capability-ish flags (temperature/tool_call/etc)
  - `~/Projects/external/opencode/packages/opencode/src/provider/models.ts:13-65`
- opencode caches models.dev to `Global.Path.cache/models.json`:
  - `~/Projects/external/opencode/packages/opencode/src/provider/models.ts:10-12`
  - `~/Projects/external/opencode/packages/opencode/src/provider/models.ts:92-109`

### 10.2 opencode config layering (where “defaults” and overrides come from)

Config is multi-layered (lowest precedence first):
1) Remote `/.well-known/opencode` config for “wellknown” auth entries
2) Global user config
3) `OPENCODE_CONFIG` custom config path
4) Project config: nearest `opencode.jsonc` / `opencode.json` (find-up)
5) `OPENCODE_CONFIG_CONTENT` inline JSON

Source: `~/Projects/external/opencode/packages/opencode/src/config/config.ts:39-86`

In addition, opencode scans `Global.Path.config` + `.opencode` directories and loads:
- commands (`{command,commands}/**/*.md`)
- agents
- modes
- plugins

Source: `~/Projects/external/opencode/packages/opencode/src/config/config.ts:92-135`

### 10.3 How opencode defines and configures “reasoning knobs”

opencode does NOT define a single provider-agnostic “reasoning config schema”.
Instead, it defines **named model variants** (presets) that map to provider-specific request-body knobs.

There are two separable concepts:
1) **Tuning**: “how hard it thinks” (variants)
2) **Display**: whether to show reasoning text in UI (thinking visibility toggle)

#### 10.3.1 Variants (the “tuning” abstraction)

Variant names are the user-facing abstraction. For many providers, variants use a quasi-unified set:
- Common: `low`, `medium`, `high`
- OpenAI-ish: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
- Budget-ish: `high`, `max` (where `max` sets a large thinking budget)

Variant generation rules:
- Only generated if `model.capabilities.reasoning === true`.
- Explicitly skipped for some families (`deepseek`, `minimax`, `glm`, `mistral`) — so “variants for all models”
  is not opencode’s current goal.
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:319-339`

Variant generation is implemented in:
- `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:316-525`

Provider-specific mappings (selected examples):
- OpenAI (`@ai-sdk/openai`):
  - uses `reasoningEffort: <effort>` plus `reasoningSummary` and `include: ["reasoning.encrypted_content"]`
  - effort list depends on `model.release_date` and model ID (e.g. GPT-5 vs Codex).
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:389-418`
- Azure (`@ai-sdk/azure`):
  - similar to OpenAI but with exclusions (e.g. `o1-mini`).
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:372-388`
- Anthropic (`@ai-sdk/anthropic`):
  - uses budget-based `thinking: { type: "enabled", budgetTokens: 16000|31999 }`
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:420-435`
- Bedrock (`@ai-sdk/amazon-bedrock`):
  - if Anthropic-on-Bedrock: `reasoningConfig: { type: "enabled", budgetTokens }` (high/max)
  - else (Nova): `reasoningConfig: { type: "enabled", maxReasoningEffort: low|medium|high }`
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:437-468`
- Google / Vertex (`@ai-sdk/google`, `@ai-sdk/google-vertex`):
  - Gemini 2.5-ish IDs: `thinkingConfig: { includeThoughts: true, thinkingBudget: 16000|24576 }` (high/max)
  - Else: `includeThoughts: true, thinkingLevel: low|high`
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:470-498`
- OpenRouter (`@openrouter/ai-sdk-provider`):
  - only exposes variants for some models (GPT + Gemini-3)
  - uses OpenRouter’s `reasoning: { effort }` rather than OpenAI’s `reasoningEffort`
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:341-344`
- OpenAI-compatible (`@ai-sdk/openai-compatible`) and several OpenAI-ish gateways:
  - uses `reasoningEffort: low|medium|high`
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:361-371`

#### 10.3.2 Configurable variants (how users can override/disable presets)

Users can configure variants per model in `opencode.jsonc` by provider/model:
- Schema:
  - `provider[providerID].models[modelID].variants[variantName]`
  - each variant object supports `disabled: true` + arbitrary provider-specific fields (catchall)
  - `~/Projects/external/opencode/packages/opencode/src/config/config.ts:818-837`

Registry merge behavior:
- Start with computed defaults from `ProviderTransform.variants(model)`.
- Deep-merge config-provided variant objects.
- Drop any variants with `disabled: true`.
- `~/Projects/external/opencode/packages/opencode/src/provider/provider.ts:802-806`

#### 10.3.3 Variant selection persistence (NOT config)

Variant selection is treated as user UI state, persisted in:
- `Global.Path.state/model.json`
- It stores `{ recent, favorite, variant }`, where `variant` is keyed by `providerID/modelID`.
- `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx:88-147`
- The actual selection/cycle logic:
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx:319-355`

### 10.4 UX: how opencode exposes reasoning (tuning + display)

#### 10.4.1 TUI: “Variant cycle” (tuning)

Key points:
- Default keybind: `ctrl+t` (configurable).
  - `~/Projects/external/opencode/packages/opencode/src/config/config.ts:689-693`
- The keybind is wired to a hidden command that cycles the current model’s variant.
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/app.tsx:407-415`
- Cycle behavior: `undefined -> firstVariant -> ... -> lastVariant -> undefined`
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx:341-355`
- Prompt footer shows the currently selected variant next to the model name (and shows a hint for the keybind).
  - Display in footer:
    `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:940-956`
  - Keybind hint:
    `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:1070-1076`
- When you submit a prompt, the selected variant is included on the outgoing request:
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:531-590`

CLI (non-TUI) also supports specifying a variant:
- `opencode run --variant <name>`
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/run.ts:90-93`
  - request payload includes `variant: args.variant`
    `~/Projects/external/opencode/packages/opencode/src/cli/cmd/run.ts:254-272`

Note: opencode’s `run` output does NOT print reasoning parts; it prints tool calls + the final text part.
`--format json` also doesn’t currently emit reasoning parts (it only serializes tool/text/step/error).
- `~/Projects/external/opencode/packages/opencode/src/cli/cmd/run.ts:157-191`

#### 10.4.2 TUI: “Show thinking” (display)

opencode treats showing reasoning as a UI preference:
- The session route has a `thinking_visibility` toggle stored in `kv.json`.
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:143-146`
  - KV persistence:
    `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/kv.tsx:7-58`
- It is wired as a slash-command:
  - `/thinking` toggles visibility
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:528-540`
- Reasoning parts are rendered as muted `_Thinking:_ ...` blocks when enabled.
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1323-1353`
- Exported transcripts optionally include reasoning:
  - `formatTranscript(..., { thinking: boolean })`
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts:4-66`
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts:73-85`

### 10.5 Runtime: prompt -> providerOptions -> streaming -> persistence -> display

This is the full “wire” from a user action to a displayed reasoning block.

#### 10.5.1 User submits a prompt (variant included)

- TUI prompt includes `variant` in the session prompt request:
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:570-590`
- Server-side prompt input schema accepts `variant?: string`:
  - `~/Projects/external/opencode/packages/opencode/src/session/prompt.ts:85-104`
- The created user message persists it as `MessageV2.Info.variant`:
  - `~/Projects/external/opencode/packages/opencode/src/session/prompt.ts:832-846`

#### 10.5.2 Variants turn into concrete providerOptions on the LLM call

In `LLM.stream()`:
1) `variant` resolves to `input.model.variants[input.user.variant]` (or `{}`).
2) `base` options are computed via `ProviderTransform.options(...)` (or `smallOptions`).
3) All options are deep-merged: `base <- model.options <- agent.options <- variant`.
4) ProviderOptions are wrapped under the SDK provider namespace key (`openai`, `anthropic`, etc).

Source:
- Variant + merge:
  - `~/Projects/external/opencode/packages/opencode/src/session/llm.ts:67-99`
- Base options generation:
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:528-600`
- Wrapping under the correct `providerOptions` key:
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:625-628`
  - `~/Projects/external/opencode/packages/opencode/src/session/llm.ts:142-149`

#### 10.5.3 Message transforms that matter for reasoning

Before the request is sent, opencode normalizes the messages (important for reasoning + tool loops):

1) **Interleaved reasoning transform** (openai-compatible models):
   - If `model.capabilities.interleaved.field` is set:
     - extract assistant reasoning parts, join text
     - remove reasoning parts from assistant message content
     - attach `providerOptions.openaiCompatible[field] = reasoningText` onto that message
   - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:126-159`

2) **providerOptions key remap**:
   - Stored messages may use `providerID` keys, but AI SDK expects keys by provider package namespace.
   - `sdkKey(npm)` maps `@ai-sdk/openai` -> `openai`, `@ai-sdk/anthropic` -> `anthropic`, etc.
   - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:11-40`
   - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:256-276`

3) **Reasoning extraction middleware for `<think>` tags**:
   - They always enable `extractReasoningMiddleware({ tagName: "think" })` so models that emit literal
     `<think>...</think>` get split into reasoning events/parts.
   - `~/Projects/external/opencode/packages/opencode/src/session/llm.ts:240-252`
   - (AI SDK reference: `~/Projects/external/ai/packages/ai/src/middleware/extract-reasoning-middleware.ts`)

#### 10.5.4 Streaming events -> persisted reasoning parts

The stream produces `reasoning-start` / `reasoning-delta` / `reasoning-end` events.
opencode converts each reasoning stream into a persisted `MessageV2.ReasoningPart`.

Key behavior:
- `reasoning-start` creates a new reasoning part (with provider metadata).
- `reasoning-delta` appends text and writes incremental updates.
- `reasoning-end` trims trailing whitespace, sets end time, writes final part.

Source:
- `~/Projects/external/opencode/packages/opencode/src/session/processor.ts:58-106`
- Reasoning part schema:
  - `~/Projects/external/opencode/packages/opencode/src/session/message-v2.ts:78-89`
- Persistence + event fanout to the UI:
  - `Session.updatePart()` writes to storage and publishes a `message.part.updated` event (with `delta` for streaming).
  - `~/Projects/external/opencode/packages/opencode/src/session/index.ts:401-409`
  - TUI listens to `message.part.updated` and updates `sync.data.part[messageID]`, which drives rendering.
  - `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/sync.tsx:281-299`

#### 10.5.5 Display (TUI session view)

Once persisted, the session UI shows the `reasoning` parts (if `thinking_visibility` is enabled):
- `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1317-1354`

Also note an OpenRouter-specific UI filter:
- They strip `[REDACTED]` from reasoning text before display.
- `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1327-1330`

### 10.6 Interleaved reasoning: what it is (and why opencode cares)

Interleaved thinking is the behavior: the model reasons *between* tool calls (rather than “think once at the start”).
Some APIs then impose a continuity requirement: to preserve that chain across tool invocations, you must include
the model’s earlier reasoning back in the follow-up request (in addition to tool calls/results).

In OpenAI-compatible APIs, that continuity is commonly represented as `reasoning_content` or `reasoning_details`
fields rather than (or in addition to) an AI-SDK `reasoning` content part.

opencode’s support is capability-driven:
- models.dev provides `interleaved: { field: "reasoning_content" | "reasoning_details" }`
  - `~/Projects/external/opencode/packages/opencode/src/provider/models.ts:22-31`
- opencode rewrites outgoing messages accordingly:
  - `~/Projects/external/opencode/packages/opencode/src/provider/transform.ts:126-159`

This is a strong concrete example of “registry-driven compatibility transforms” that Dexto likely needs as well.
