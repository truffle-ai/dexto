# Dexto Reasoning Control Implementation Plan

This document outlines the plan to add reasoning/thinking control to Dexto's LLM configuration, based on research from OpenCode's implementation.

## Overview

Different LLM providers implement "reasoning" or "thinking" capabilities differently:
- **Anthropic** - Extended Thinking with token budgets
- **OpenAI** - Reasoning Effort levels
- **Google** - Thinking Config with budgets
- **DeepSeek** - Thinking Mode for R1 models
- **xAI** - Grok reasoning models
- **Groq** - Hosted DeepSeek R1 models

Dexto will provide a **unified, simple schema** that abstracts these differences, while internally translating to provider-specific configurations.

---

## Architecture

### Understanding HTTP Requests

At the lowest level, every LLM API call is an HTTP request with three parts:

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Request                          │
├─────────────────────────────────────────────────────────┤
│ 1. URL:     https://api.anthropic.com/v1/messages       │
│                                                          │
│ 2. Headers:                                              │
│    Content-Type: application/json                        │
│    x-api-key: sk-ant-...                                │
│    anthropic-beta: interleaved-thinking-2025-05-14      │
│                                                          │
│ 3. Body (JSON):                                          │
│    {                                                     │
│      "model": "claude-sonnet-4-5",                      │
│      "thinking": { "type": "enabled", "budget_tokens": 16000 },
│      "messages": [...]                                  │
│    }                                                     │
└─────────────────────────────────────────────────────────┘
```

**Key insight:** Reasoning configuration goes into the **request body**, not headers.

### How Vercel AI SDK Makes Requests

The SDK uses a simple `fetch()` call under the hood:

```typescript
// From packages/provider-utils/src/post-to-api.ts
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),  // <-- reasoning config ends up here
});
```

### Two Levels of Configuration

#### Level 1: Provider Creation (affects ALL requests)

```typescript
const anthropic = createAnthropic({
  baseURL: "https://api.anthropic.com/v1",   // URL
  apiKey: "sk-ant-...",                       // Goes into x-api-key header
  headers: { "custom-header": "value" },      // Merged into headers
  fetch: customFetch,                         // Custom fetch middleware
});
```

#### Level 2: Per-Request (streamText/generateText)

```typescript
streamText({
  model: anthropic("claude-sonnet-4-5"),

  // Custom headers for THIS request only
  headers: { "x-request-id": "123" },

  // Goes into REQUEST BODY (not headers!)
  providerOptions: {
    anthropic: {
      thinking: { type: "enabled", budgetTokens: 16000 }
    }
  }
});
```

### How providerOptions Works

The `providerOptions` object uses provider names as namespaces. The SDK extracts and transforms them:

```
You write:                           SDK extracts:                    API receives:
─────────────────────────────────────────────────────────────────────────────────
providerOptions: {                   anthropicOptions = {             body: {
  anthropic: {           ────────►     thinking: {        ────────►     thinking: {
    thinking: {                          type: "enabled",                 type: "enabled",
      type: "enabled",                   budgetTokens: 16000              budget_tokens: 16000
      budgetTokens: 16000              }                                }
    }                                }                                }
  }
}
```

**Why the namespace?** You might use multiple providers in the same app:

```typescript
providerOptions: {
  anthropic: { thinking: {...} },      // for Anthropic models
  openai: { reasoningEffort: "high" }, // for OpenAI models
  google: { thinkingConfig: {...} },   // for Google models
}
```

### OpenAI-Compatible Passthrough Mechanism

For `openai-compatible` providers, the SDK has a **passthrough** for unknown options:

```typescript
// From openai-compatible-chat-language-model.ts lines 188-195
...Object.fromEntries(
  Object.entries(
    providerOptions?.[this.providerOptionsName] ?? {},
  ).filter(
    ([key]) =>
      !Object.keys(openaiCompatibleProviderOptions.shape).includes(key),
  ),
),
```

This means any unknown key gets passed directly to the request body:

```typescript
providerOptions: {
  openaiCompatible: {
    reasoningEffort: "high",     // Known option → handled specially
    myCustomField: "value",      // Unknown → passed through to body!
    anotherField: 123,           // Unknown → passed through to body!
  }
}
```

**Results in request body:**
```json
{
  "model": "deepseek-reasoner",
  "reasoning_effort": "high",
  "myCustomField": "value",
  "anotherField": 123,
  "messages": [...]
}
```

### Controlling Headers vs Body

| What you want | How to do it |
|---------------|--------------|
| Custom **headers** (all requests) | `createProvider({ headers: {...} })` |
| Custom **headers** (one request) | `streamText({ headers: {...} })` |
| Known **body options** | `providerOptions: { anthropic: { thinking: {...} } }` |
| **Arbitrary body fields** (openai-compatible) | Add unknown keys to `providerOptions.openaiCompatible` |
| **Full control** | Use `fetch` middleware to intercept/modify requests |

### Anthropic Beta Headers (Auto-Generated)

For Anthropic, the SDK automatically generates the `anthropic-beta` header based on features used:

```typescript
// From anthropic-messages-language-model.ts line 444-448
return combineHeaders(
  await resolve(this.config.headers),    // base headers (auth)
  headers,                                // user-provided headers
  betas.size > 0 ? { 'anthropic-beta': Array.from(betas).join(',') } : {},
);
```

You don't need to manually set this header - it's added when thinking is enabled.

---

### Where Reasoning Config Goes in Vercel AI SDK

All reasoning configuration goes into the **request body** via `providerOptions`. The Vercel AI SDK handles the translation to provider-specific API formats.

**NOT headers** - Headers are only used for authentication and feature flags. The Anthropic SDK auto-generates the `anthropic-beta` header when thinking features are used.

```typescript
streamText({
  model,
  messages,
  providerOptions: {
    // Anthropic - goes into request body as: thinking: { type, budget_tokens }
    anthropic: {
      thinking: { type: "enabled", budgetTokens: 16000 }
    },

    // OpenAI - goes into request body as: reasoning_effort
    openai: {
      reasoningEffort: "high"
    },

    // OpenAI-Compatible - goes into request body as: reasoning_effort
    openaiCompatible: {
      reasoningEffort: "high"
    },

    // Google - goes into request body as: thinkingConfig
    google: {
      thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 }
    }
  }
})
```

### Provider-Specific Request Body Fields

| Provider | providerOptions Key | Request Body Field |
|----------|--------------------|--------------------|
| Anthropic | `thinking.type`, `thinking.budgetTokens` | `thinking: { type, budget_tokens }` |
| OpenAI | `reasoningEffort` | `reasoning_effort` |
| OpenAI-Compatible | `reasoningEffort` | `reasoning_effort` |
| Google | `thinkingConfig` | `thinkingConfig` |

### DeepSeek Special Case (Message-Level)

DeepSeek requires passing previous reasoning content when continuing after tool calls:

```typescript
// On individual messages for tool call continuation
{
  role: "assistant",
  content: [...],
  providerOptions: {
    openaiCompatible: { reasoning_content: "previous thinking..." }
  }
}
```

### Response Handling

The SDK reads reasoning from responses:
- OpenAI/Compatible: `choice.message.reasoning_content` or `choice.message.reasoning`
- Anthropic: `thinking` content blocks
- Google: Thinking content in response

---

## User-Facing Schema

### Simple Unified Config

Users configure reasoning with a simple, provider-agnostic schema:

```typescript
// packages/core/src/llm/schemas.ts

const ReasoningConfigSchema = z.object({
  enabled: z.boolean().default(false)
    .describe('Enable reasoning/thinking mode. Defaults to false (standard mode).'),

  budget: z.number().int().positive().optional()
    .describe('Token budget for thinking (Anthropic, Google). Defaults vary by provider.'),

  effort: z.enum(['low', 'medium', 'high']).optional()
    .describe('Reasoning effort level (OpenAI models). Defaults to "medium".'),
}).strict().optional();
```

### Schema Behavior

```yaml
# No reasoning block = no reasoning (standard model behavior)
llm:
  model: gpt-4o

# Empty reasoning block = no reasoning (enabled defaults to false)
llm:
  model: claude-sonnet-4-5
  reasoning: {}

# Explicit enable with defaults
llm:
  model: claude-sonnet-4-5
  reasoning:
    enabled: true  # Uses provider default budget

# Full config
llm:
  model: claude-sonnet-4-5
  reasoning:
    enabled: true
    budget: 16000
```

### Add to LLMConfigFields

```typescript
const LLMConfigFields = {
  provider: z.enum(LLM_PROVIDERS),
  model: NonEmptyTrimmed,
  apiKey: EnvExpandedString(),
  maxIterations: z.coerce.number().int().positive(),
  baseURL: OptionalURL,
  maxInputTokens: z.coerce.number().int().positive().optional(),
  maxOutputTokens: z.coerce.number().int().positive().optional(),
  temperature: z.coerce.number().min(0).max(1).optional(),
  allowedMediaTypes: z.array(z.string()).optional(),

  // NEW: Reasoning config
  reasoning: ReasoningConfigSchema,

  // NEW: Escape hatches for power users (passthrough to Vercel AI SDK)
  providerOptions: z.record(z.string(), z.any()).optional()
    .describe('Raw provider options passed directly to Vercel AI SDK streamText/generateText (advanced)'),

  headers: z.record(z.string(), z.string()).optional()
    .describe('Custom headers passed to provider client creation (advanced)'),
} as const;
```

---

## YAML Configuration Examples

### Anthropic (Claude) - Extended Thinking

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
  reasoning:
    enabled: true
    budget: 16000  # thinking token budget
```

### OpenAI (GPT-5, o1, o3) - Reasoning Effort

```yaml
llm:
  provider: openai
  model: gpt-5.1
  apiKey: $OPENAI_API_KEY
  reasoning:
    enabled: true
    effort: high  # low | medium | high
```

### Google (Gemini) - Thinking Config

```yaml
llm:
  provider: google
  model: gemini-2.5-pro
  apiKey: $GOOGLE_API_KEY
  reasoning:
    enabled: true
    budget: 8000
```

### DeepSeek - Thinking Mode

```yaml
llm:
  provider: openai-compatible
  model: deepseek-reasoner
  apiKey: $DEEPSEEK_API_KEY
  baseURL: https://api.deepseek.com/v1
  reasoning:
    enabled: true
```

### Power User Override (Escape Hatch)

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
  # Direct provider options (overrides reasoning config)
  providerOptions:
    anthropic:
      thinking:
        type: enabled
        budgetTokens: 32000
  headers:
    anthropic-beta: "interleaved-thinking-2025-05-14,other-beta-feature"
```

---

## Internal Translation Layer

### Provider Options Transform

Create a new module to translate unified config to provider-specific options:

```typescript
// packages/core/src/llm/reasoning/provider-options.ts

import { LLMProvider } from '../types.js';
import { getModelInfo } from '../registry.js';
import type { IDextoLogger } from '../logger/v2/types.js';

interface ReasoningConfig {
  enabled?: boolean;
  budget?: number;
  effort?: 'low' | 'medium' | 'high';
}

interface TransformContext {
  provider: LLMProvider;
  model: string;
  reasoning?: ReasoningConfig;
  temperature?: number;
  logger?: IDextoLogger;
}

/**
 * Transforms unified reasoning config to provider-specific providerOptions.
 * Returns empty object if reasoning is disabled or not applicable.
 *
 * Emits warnings for:
 * - Reasoning requested on non-supporting model
 * - Mismatched config (budget on OpenAI, effort on Anthropic)
 * - Temperature set with reasoning on OpenAI (not supported)
 */
export function toProviderOptions(ctx: TransformContext): Record<string, unknown> {
  const { provider, model, reasoning, temperature, logger } = ctx;

  // No config or explicitly disabled = no provider options
  if (!reasoning?.enabled) return {};

  // Check registry for reasoning support
  const modelInfo = getModelInfo(provider, model);

  // Warn about mismatched config options
  emitMismatchWarnings(provider, reasoning, logger);

  // Warn about temperature + reasoning on OpenAI
  if (provider === 'openai' && temperature !== undefined && modelInfo?.reasoning?.supported) {
    logger?.warn(
      `Temperature is not supported for OpenAI reasoning models and will be ignored`
    );
  }

  // For models not in registry (e.g., openai-compatible custom endpoints)
  // we can't validate reasoning support - proceed with provider-specific handling
  if (modelInfo && !modelInfo.reasoning?.supported) {
    logger?.warn(
      `Reasoning requested but model '${model}' does not support it - config will be ignored`
    );
    return {};
  }

  switch (provider) {
    case 'anthropic':
      return toAnthropicOptions(reasoning, modelInfo?.reasoning?.defaultBudget);
    case 'openai':
      return toOpenAIOptions(reasoning);
    case 'google':
      return toGoogleOptions(reasoning, modelInfo?.reasoning?.defaultBudget);
    case 'openai-compatible':
      // String matching necessary - openai-compatible models not in registry
      return toOpenAICompatibleOptions(model, reasoning);
    case 'xai':
      // xAI/Grok reasoning is always-on and cannot be disabled
      return {};
    case 'groq':
      return toGroqOptions(model, reasoning);
    default:
      return {};
  }
}

/**
 * Warn about config options that will be ignored for the given provider.
 */
function emitMismatchWarnings(
  provider: LLMProvider,
  reasoning: ReasoningConfig,
  logger?: IDextoLogger
): void {
  // Budget only applies to Anthropic and Google
  if (reasoning.budget !== undefined && !['anthropic', 'google'].includes(provider)) {
    logger?.warn(
      `'reasoning.budget' is only supported for Anthropic and Google - ignored for ${provider}`
    );
  }

  // Effort only applies to OpenAI
  if (reasoning.effort !== undefined && provider !== 'openai') {
    logger?.warn(
      `'reasoning.effort' is only supported for OpenAI - ignored for ${provider}`
    );
  }
}

function toAnthropicOptions(
  reasoning: ReasoningConfig,
  defaultBudget?: number
): Record<string, unknown> {
  // Anthropic SDK auto-generates the anthropic-beta header when thinking is used
  return {
    anthropic: {
      thinking: {
        type: 'enabled',
        budgetTokens: reasoning.budget ?? defaultBudget ?? 10000,
      }
    }
  };
}

function toOpenAIOptions(reasoning: ReasoningConfig): Record<string, unknown> {
  return {
    openai: {
      reasoningEffort: reasoning.effort ?? 'medium',
      reasoningSummary: 'auto',
    }
  };
}

function toGoogleOptions(
  reasoning: ReasoningConfig,
  defaultBudget?: number
): Record<string, unknown> {
  return {
    google: {
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: reasoning.budget ?? defaultBudget ?? undefined,
      }
    }
  };
}

function toOpenAICompatibleOptions(
  model: string,
  reasoning: ReasoningConfig
): Record<string, unknown> {
  // DeepSeek R1 models have thinking enabled by default
  // For other openai-compatible endpoints, pass reasoningEffort if set
  if (model.toLowerCase().includes('deepseek')) {
    return {}; // DeepSeek R1 always thinks, no config needed
  }

  // Generic openai-compatible with reasoning effort
  if (reasoning.effort) {
    return {
      openaiCompatible: {
        reasoningEffort: reasoning.effort,
      }
    };
  }
  return {};
}

function toGroqOptions(model: string, reasoning: ReasoningConfig): Record<string, unknown> {
  // Groq hosts DeepSeek R1 models - same handling
  if (model.toLowerCase().includes('deepseek')) {
    return {}; // DeepSeek R1 always thinks
  }
  return {};
}
```

### No Separate Headers Module Needed

The Vercel AI SDK automatically generates the `anthropic-beta` header when thinking features are used via `providerOptions`. We don't need to manage this manually.

The `headers` field in config is a **passthrough escape hatch** for power users who need custom headers for any reason - it's passed directly to the provider client creation without reasoning-specific logic.

### Warnings Emitted

The transform layer emits warnings for common misconfigurations:

| Condition | Warning Message |
|-----------|-----------------|
| `reasoning.enabled: true` on non-supporting model | "Reasoning requested but model 'X' does not support it - config will be ignored" |
| `reasoning.budget` set on OpenAI/xAI/Groq | "'reasoning.budget' is only supported for Anthropic and Google - ignored for X" |
| `reasoning.effort` set on non-OpenAI provider | "'reasoning.effort' is only supported for OpenAI - ignored for X" |
| `temperature` set with reasoning on OpenAI | "Temperature is not supported for OpenAI reasoning models and will be ignored" |

These warnings help users catch configuration mistakes without failing hard.

---

## Registry Enhancement

Add reasoning capability flag to model registry:

```typescript
// packages/core/src/llm/registry.ts

export interface ModelInfo {
  name: string;
  maxInputTokens: number;
  default?: boolean;
  supportedFileTypes: SupportedFileType[];
  displayName?: string;
  pricing?: { /* ... */ };

  // NEW: Reasoning capabilities
  reasoning?: {
    supported: boolean;
    defaultBudget?: number;  // Provider-specific default
  };
}

/**
 * Get full model info from registry.
 * Returns null for unknown models (e.g., openai-compatible custom models).
 */
export function getModelInfo(provider: LLMProvider, model: string): ModelInfo | null {
  const providerInfo = LLM_REGISTRY[provider];
  if (!providerInfo) return null;

  // Case-insensitive lookup
  return providerInfo.models.find(
    m => m.name.toLowerCase() === model.toLowerCase()
  ) ?? null;
}
```

### Example Registry Updates

```typescript
// Anthropic models
{
  name: 'claude-sonnet-4-5-20250929',
  displayName: 'Claude 4.5 Sonnet',
  maxInputTokens: 200000,
  supportedFileTypes: ['pdf', 'image'],
  reasoning: {
    supported: true,
    defaultBudget: 10000,
  },
},

// OpenAI models
{
  name: 'gpt-5.1',
  displayName: 'GPT-5.1 Thinking',
  maxInputTokens: 400000,
  supportedFileTypes: ['pdf', 'image'],
  reasoning: {
    supported: true,
  },
},

// Non-reasoning model
{
  name: 'gpt-4o',
  displayName: 'GPT-4o',
  maxInputTokens: 128000,
  supportedFileTypes: ['pdf', 'image'],
  reasoning: {
    supported: false,
  },
},
```

---

## Factory Updates

Update the factory to pass through user-provided headers (escape hatch only):

```typescript
// packages/core/src/llm/services/factory.ts

function _createVercelModel(llmConfig: ValidatedLLMConfig): LanguageModel {
  const provider = llmConfig.provider;
  const model = llmConfig.model;
  const apiKey = llmConfig.apiKey;
  const headers = llmConfig.headers; // Passthrough escape hatch

  switch (provider.toLowerCase()) {
    case 'openai':
      return createOpenAI({ apiKey, headers })(model);

    case 'anthropic':
      // SDK auto-generates anthropic-beta header when thinking is used
      return createAnthropic({ apiKey, headers })(model);

    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);

    case 'openai-compatible':
      return createOpenAI({
        apiKey,
        baseURL: llmConfig.baseURL,
        headers,
      })(model);

    // ... other providers with headers passthrough
  }
}
```

**Notes:**
- The factory does NOT inject reasoning-specific headers. The Vercel AI SDK handles `anthropic-beta` automatically when `providerOptions.anthropic.thinking` is set.
- Google SDK doesn't appear to support custom headers - omitted from headers passthrough.
- Headers passthrough is primarily useful for Anthropic (custom beta features) and OpenAI-compatible endpoints.

---

## TurnExecutor Updates

Pass provider options to streamText/generateText:

```typescript
// packages/core/src/llm/executor/turn-executor.ts

import { toProviderOptions } from '../reasoning/provider-options.js';

// In the execute method:
const reasoningOptions = toProviderOptions({
  provider: this.llmContext.provider,
  model: this.llmContext.model,
  reasoning: this.config.reasoning,
  temperature: this.config.temperature,
  logger: this.logger,
});

// Merge with any user-provided providerOptions (user overrides win)
const finalProviderOptions = {
  ...reasoningOptions,
  ...this.config.providerOptions,
};

const result = await streamText({
  model: this.model,
  messages,
  tools,
  providerOptions: Object.keys(finalProviderOptions).length > 0
    ? finalProviderOptions
    : undefined,
  // ...
});
```

**Merge strategy:** User-provided `providerOptions` take precedence over generated reasoning options. This allows power users to fully override the generated config if needed.

---

## Provider-Specific Details

### 1. Anthropic (Claude)

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | `thinking.type: "enabled"` | SDK auto-generates beta header |
| `enabled: false` or omitted | No providerOptions generated | SDK default (no thinking) |
| `budget: 16000` | `thinking.budgetTokens: 16000` | Max ~128k tokens |

**Beta Header:** Auto-generated by Vercel AI SDK when thinking is enabled - no manual management needed.

**Output Token Calculation:**
- When thinking enabled: `maxOutputTokens = min(modelCap - budgetTokens, standardLimit)`

**Models:** claude-sonnet-4-5-*, claude-opus-4-5-*, claude-haiku-4-5-*

---

### 2. OpenAI (GPT-5, o1, o3, o4)

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | `reasoningEffort` set | Uses effort level or default "medium" |
| `enabled: false` or omitted | No providerOptions generated | Standard model behavior |
| `effort: "low"` | `reasoningEffort: "low"` | Least thinking |
| `effort: "medium"` | `reasoningEffort: "medium"` | Default |
| `effort: "high"` | `reasoningEffort: "high"` | Most thinking |

**Additional Options:**
- `reasoningSummary: "auto"` - Include reasoning summary (auto-added)

**Models (reasoning):** o1, o1-mini, o3, o3-mini, o4-mini, gpt-5, gpt-5.1, gpt-5-codex

**Models (non-reasoning):** gpt-5-chat, gpt-4o, gpt-4o-mini

**⚠️ Temperature Warning:** Temperature and topP are NOT supported for reasoning models. If `temperature` is set with reasoning enabled, a warning will be logged and the API may reject it.

---

### 3. Google (Gemini)

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | `thinkingConfig.includeThoughts: true` | Stream thoughts |
| `enabled: false` or omitted | No providerOptions generated | SDK default (no thinking) |
| `budget: 8000` | `thinkingConfig.thinkingBudget: 8000` | Token limit |

**Models:** gemini-3-pro-*, gemini-2.5-pro, gemini-2.5-flash

---

### 4. DeepSeek

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | (default behavior) | R1 models always think |

**Special Handling:** DeepSeek requires message-level handling for tool call continuations:

```typescript
// When assistant message has tool calls + reasoning
{
  role: "assistant",
  content: filteredContent,
  providerOptions: {
    openaiCompatible: {
      reasoning_content: reasoningText,  // Pass to continue reasoning
    }
  }
}
```

**Models:** deepseek-r1, deepseek-r1-distill-*

---

### 5. xAI (Grok)

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | No providerOptions needed | Reasoning is always-on |
| `enabled: false` | No providerOptions generated | ⚠️ Cannot disable reasoning |

**Models:** grok-4, grok-3

**Note:** Grok models have reasoning built-in and always-on. The `enabled: false` setting has no effect - reasoning cannot be disabled for these models.

---

### 6. Groq (Hosted DeepSeek)

| User Config | Provider Option | Notes |
|-------------|-----------------|-------|
| `enabled: true` | (default behavior) | Same as DeepSeek |

**Models:** deepseek-r1-distill-llama-70b

---

## Stream Processing (Already Implemented)

Dexto already handles reasoning stream events in `stream-processor.ts`:

```typescript
case 'reasoning-delta':
  this.reasoningText += event.text;
  if (this.streaming) {
    this.eventBus.emit('llm:chunk', {
      chunkType: 'reasoning',
      content: event.text,
    });
  }
  break;
```

And tracks reasoning tokens:

```typescript
this.actualTokens = {
  // ...
  ...(event.usage.reasoningTokens !== undefined && {
    reasoningTokens: (this.actualTokens.reasoningTokens ?? 0) + event.usage.reasoningTokens,
  }),
};
```

---

## Implementation Phases

### Phase 1: Schema & Registry Updates
1. Add `ReasoningConfigSchema` to `schemas.ts`
2. Add `reasoning`, `providerOptions`, `headers` to `LLMConfigFields`
3. Update `ValidatedLLMConfig` type
4. Add `reasoning` capability to `ModelInfo` interface in `registry.ts`
5. Add `getModelInfo()` helper function to registry
6. Update all models in registry with `reasoning.supported` and `reasoning.defaultBudget`

### Phase 2: Transform Layer
1. Create `packages/core/src/llm/reasoning/provider-options.ts`
2. Create `packages/core/src/llm/reasoning/index.ts` (exports)

### Phase 3: Factory & Executor Integration
1. Update `factory.ts` to pass through `headers` escape hatch
2. Update `turn-executor.ts` to call `toProviderOptions()` and pass to `streamText()`

### Phase 4: DeepSeek Message Handling
1. **Persist reasoning to messages** - Update `stream-processor.ts` to store reasoning text in assistant message content or metadata
2. **Add DeepSeek message transform** - In `formatters/vercel.ts`, transform assistant messages with tool calls + reasoning to include `providerOptions.openaiCompatible.reasoning_content`
3. See "DeepSeek Message Handling" section for implementation details from OpenCode

### Phase 5: Testing
1. Unit tests for `toProviderOptions()` transform functions
2. Integration tests with Anthropic, OpenAI, Google providers
3. Verify `reasoning-delta` streaming works correctly

### Phase 6: Documentation
1. Update YAML config examples in docs
2. Document reasoning options per provider
3. Add to API documentation

---

## Files to Modify

```
packages/core/src/llm/
├── schemas.ts                    # Add ReasoningConfigSchema, providerOptions, headers
├── registry.ts                   # Add reasoning capability to ModelInfo, add getModelInfo()
├── types.ts                      # Update types if needed
├── services/
│   └── factory.ts               # Pass through headers escape hatch
├── executor/
│   └── turn-executor.ts         # Call toProviderOptions(), pass to streamText()
└── reasoning/                    # NEW directory
    ├── index.ts                 # Exports
    └── provider-options.ts      # Provider options transform (single file)
```

---

## Summary

| Provider | Reasoning Param | Token Budget | Effort Levels |
|----------|-----------------|--------------|---------------|
| Anthropic | `thinking.budgetTokens` | Yes (1-128k) | No |
| OpenAI | `reasoningEffort` | No | low/medium/high |
| Google | `thinkingConfig.thinkingBudget` | Yes | No |
| DeepSeek | (always on for R1) | No | No |
| xAI | (always on) | No | No |
| Groq | (always on for R1) | No | No |

**User-facing config is simple and unified:**
```yaml
reasoning:
  enabled: true
  budget: 16000    # for Anthropic/Google
  effort: high     # for OpenAI
```

**Dexto handles the complexity internally.**

---

## DeepSeek Message Handling - Implementation Details

**Status:** Research complete - ready for implementation.

DeepSeek R1 models require special handling for multi-turn conversations with tool calls. When the model produces reasoning and then makes tool calls, the `reasoning_content` must be passed back on subsequent assistant messages to maintain reasoning continuity.

### What We Know

From the Vercel AI SDK, DeepSeek expects:
```typescript
{
  role: "assistant",
  content: [...],
  providerOptions: {
    openaiCompatible: {
      reasoning_content: "previous thinking text..."
    }
  }
}
```

### Implementation Steps

Based on OpenCode's approach, here's what needs to be done:

1. **Persist reasoning to assistant messages**
   - Currently `stream-processor.ts` accumulates reasoning in `this.reasoningText` but doesn't persist it
   - Update `updateAssistantMessage()` to store reasoning in message content as a `reasoning` part
   - Or store in message metadata if content structure doesn't support it

2. **Transform messages at format time**
   - In `formatters/vercel.ts`, add DeepSeek-specific transformation
   - Check for assistant messages with BOTH tool calls AND reasoning parts
   - Inject `providerOptions.openaiCompatible.reasoning_content` for those messages

3. **Condition: When is it needed?**
   - Only for assistant messages that have BOTH:
     - Tool calls (the model made tool calls)
     - Reasoning content (the model produced thinking text)
   - NOT needed for: text-only responses, tool results, user messages

### Files to Investigate

**Dexto codebase:**
- `packages/core/src/llm/executor/stream-processor.ts` - Where reasoning is accumulated
- `packages/core/src/llm/formatters/vercel.ts` - Message formatting
- `packages/core/src/context/manager.ts` - History management
- `packages/core/src/session/history/` - Message persistence

**OpenCode reference (already researched):**
- `packages/opencode/src/provider/transform.ts` lines 66-104 - DeepSeek message handling

OpenCode's approach:
```typescript
// From transform.ts - DeepSeek message transformation
if (model.providerID === "deepseek" || model.api.id.toLowerCase().includes("deepseek")) {
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
      const hasToolCalls = msg.content.some((part: any) => part.type === "tool-call")
      const reasoningText = reasoningParts.map((part: any) => part.text).join("")

      // If tool calls + reasoning, include reasoning_content for continuation
      if (hasToolCalls && reasoningText) {
        return {
          ...msg,
          content: filteredContent,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              reasoning_content: reasoningText,
            },
          },
        }
      }
    }
    return msg
  })
}
```

**Key insight from OpenCode:** The transformation happens at message formatting time, checking for assistant messages that have BOTH tool calls AND reasoning parts.

**Vercel AI SDK:**
- `packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts` lines 247-254 - How reasoning is read from responses
