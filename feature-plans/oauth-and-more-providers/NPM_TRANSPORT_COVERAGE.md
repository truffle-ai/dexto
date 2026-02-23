# NPM / Transport Coverage Snapshot (models.dev → runtime mapping)

Date: **2026-02-18**

Source: `https://models.dev/api.json`

Purpose: models.dev encodes the intended Vercel AI SDK provider module via `provider.npm`. Grouping provider IDs by `npm` gives us a *small, stable set of “transport kinds”* to implement, while still enabling a path to supporting “all providers”.

This file is a concrete snapshot of:
- models.dev provider IDs grouped by `npm` (23 unique values as of this date)
- what Dexto can support *immediately* (based on existing core dependencies + transports)
- what requires additional work (new deps and/or bespoke drivers)

Related:
- Provider IDs snapshot: [`PROVIDER_COVERAGE.md`](./PROVIDER_COVERAGE.md)
- Direction rationale: [`UPDATED_DIRECTION.md`](./UPDATED_DIRECTION.md)

---

## 1) Summary

- Total models.dev providers: **94**
- Unique `provider.npm` values: **23**
- Providers covered by Dexto’s **existing** transport surface (no new deps): **81 / 94**
  - This is because **64 / 94** providers are `@ai-sdk/openai-compatible` (OpenAI Chat + baseURL).

Unique npm counts (from models.dev):
- 64 `@ai-sdk/openai-compatible`
- 7 `@ai-sdk/anthropic`
- 2 `@ai-sdk/openai`
- 2 `@ai-sdk/azure`
- 1 each for the remaining 18 values

---

## 2) Dexto “transport kinds” (stable) vs provider IDs (dynamic)

The intended architecture (post Phase 1.5/2.3):
- **Transport kinds** in core remain a small, stable set (OpenAI, OpenAI-compatible, Anthropic, Vertex, Bedrock, etc.).
- **Provider IDs** can expand dynamically (models.dev’s 94 providers) by mapping:
  - `provider.npm` → transport kind
  - `provider.api` (when present) → baseURL
  - `provider.env` / `provider.doc` → connect UX hints

This keeps a clear path to “all providers” while keeping runtime code small; it’s fine if `LLM_PROVIDERS` becomes a 94-item union **as long as it’s generated** (not hand-maintained).

---

## 3) Coverage status (as of this repo today)

### 3.1 Covered by existing core dependencies (81 providers)

These `npm` values already correspond to SDKs we have (or can route via `createOpenAI`), so Phase 2.3 can expose these providers without adding new packages:

- `@ai-sdk/openai-compatible` (64) → `createOpenAI({ baseURL }).chat(model)`
- `@ai-sdk/openai` (2) → `createOpenAI({ baseURL? }).responses(model)` (or `.chat` where needed)
- `@ai-sdk/anthropic` (7) → `createAnthropic({ baseURL? })(model)`
- `@ai-sdk/google` (1) → `createGoogleGenerativeAI({ apiKey })(model)`
- `@ai-sdk/google-vertex` (1) → `createVertex({ project, location })(model)` (ADC)
- `@ai-sdk/google-vertex/anthropic` (1) → `createVertexAnthropic({ project, location })(model)` (ADC)
- `@ai-sdk/groq` (1) → `createGroq({ apiKey })(model)`
- `@ai-sdk/xai` (1) → `createXai({ apiKey })(model)`
- `@ai-sdk/cohere` (1) → `createCohere({ apiKey })(model)`
- `@ai-sdk/amazon-bedrock` (1) → `createAmazonBedrock({ region })(model)` (AWS creds)
- `@openrouter/ai-sdk-provider` (1) → Dexto can route via `createOpenAI({ baseURL: openrouter }).responses(model)` (no need to import the OpenRouter SDK initially)

### 3.2 Not covered yet (13 providers; 12 npm values)

These providers require either:
- adding the provider SDK package + wiring, or
- a deliberate compatibility strategy (eg treat as OpenAI-compatible by adding a curated baseURL if the upstream supports it), or
- deferring support.

Not covered `npm` values:
- `@ai-sdk/azure` (2 providers)
- `@ai-sdk/cerebras` (1)
- `@ai-sdk/deepinfra` (1)
- `@ai-sdk/mistral` (1)
- `@ai-sdk/perplexity` (1)
- `@ai-sdk/togetherai` (1)
- `@ai-sdk/gateway` (1) — Vercel AI Gateway provider module in models.dev
- `@ai-sdk/vercel` (1) — v0 provider module
- `ai-gateway-provider` (1) — Cloudflare AI Gateway provider module
- `venice-ai-sdk-provider` (1)
- `@gitlab/gitlab-ai-provider` (1)
- `@jerome-benoit/sap-ai-provider-v2` (1)

---

## 4) Provider IDs grouped by `provider.npm` (snapshot)

## @ai-sdk/amazon-bedrock (1)

```text
amazon-bedrock
```

## @ai-sdk/anthropic (7)

```text
anthropic
kimi-for-coding
minimax
minimax-cn
minimax-cn-coding-plan
minimax-coding-plan
zenmux
```

## @ai-sdk/azure (2)

```text
azure
azure-cognitive-services
```

## @ai-sdk/cerebras (1)

```text
cerebras
```

## @ai-sdk/cohere (1)

```text
cohere
```

## @ai-sdk/deepinfra (1)

```text
deepinfra
```

## @ai-sdk/gateway (1)

```text
vercel
```

## @ai-sdk/google (1)

```text
google
```

## @ai-sdk/google-vertex (1)

```text
google-vertex
```

## @ai-sdk/google-vertex/anthropic (1)

```text
google-vertex-anthropic
```

## @ai-sdk/groq (1)

```text
groq
```

## @ai-sdk/mistral (1)

```text
mistral
```

## @ai-sdk/openai (2)

```text
openai
vivgrid
```

## @ai-sdk/openai-compatible (64)

```text
302ai
abacus
aihubmix
alibaba
alibaba-cn
bailing
baseten
berget
chutes
cloudferro-sherlock
cloudflare-workers-ai
cortecs
deepseek
fastrouter
fireworks-ai
firmware
friendli
github-copilot
github-models
helicone
huggingface
iflowcn
inception
inference
io-net
jiekou
kilo
kuae-cloud-coding-plan
llama
lmstudio
lucidquery
moark
modelscope
moonshotai
moonshotai-cn
morph
nano-gpt
nebius
nova
novita-ai
nvidia
ollama-cloud
opencode
ovhcloud
poe
privatemode-ai
qihang-ai
qiniu-ai
requesty
scaleway
siliconflow
siliconflow-cn
stackit
stepfun
submodel
synthetic
upstage
vultr
wandb
xiaomi
zai
zai-coding-plan
zhipuai
zhipuai-coding-plan
```

## @ai-sdk/perplexity (1)

```text
perplexity
```

## @ai-sdk/togetherai (1)

```text
togetherai
```

## @ai-sdk/vercel (1)

```text
v0
```

## @ai-sdk/xai (1)

```text
xai
```

## @gitlab/gitlab-ai-provider (1)

```text
gitlab
```

## @jerome-benoit/sap-ai-provider-v2 (1)

```text
sap-ai-core
```

## @openrouter/ai-sdk-provider (1)

```text
openrouter
```

## ai-gateway-provider (1)

```text
cloudflare-ai-gateway
```

## venice-ai-sdk-provider (1)

```text
venice
```
