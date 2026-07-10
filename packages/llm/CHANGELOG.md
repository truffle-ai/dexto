# @dexto/llm

## 1.9.6

### Patch Changes

- c21d575: Correct GPT-5.6 registry limits, long-context pricing, and model-specific reasoning effort levels,
  including `ultra` support for Sol and Terra.

## 1.9.5

### Patch Changes

- c65884d: Refresh the model registry with the latest OpenAI models, including GPT-5.6.

## 1.9.4

## 1.9.3

## 1.9.2

## 1.9.1

### Patch Changes

- 023f297: Regenerate the LLM model registry and preserve URL payloads while cloning structured messages.

## 1.9.0

### Minor Changes

- 5500bad: Update hosted Dexto defaults to use the app.dexto.ai domain for login, control-plane requests, and the Nova gateway.

## 1.8.12

## 1.8.11

## 1.8.10

## 1.8.9

### Patch Changes

- c3bd5fd: Remove unsupported max reasoning from OpenRouter and Dexto Nova adaptive profiles

## 1.8.8

### Patch Changes

- 649b0a2: Fix Claude Fable 5 registry and adaptive reasoning handling

## 1.8.7

### Patch Changes

- 5e2aaea: Refresh the generated LLM model registry.

## 1.8.6

## 1.8.5

### Patch Changes

- a4a9d36: Refresh the generated model catalog from models.dev.

## 1.8.4

## 1.8.3

## 1.8.2

## 1.8.1

### Patch Changes

- a50dd28: Extract shared LLM catalog and reasoning metadata into @dexto/llm, wire core, CLI, TUI, server, and agent-management to consume it, and use OpenAI-compatible Dexto Nova transport semantics.
