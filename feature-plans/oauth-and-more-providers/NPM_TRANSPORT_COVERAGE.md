# NPM / Transport Coverage Snapshot (models.dev → runtime mapping)

Date: **2026-02-25**

Source:
- `https://models.dev/api.json`
- generated local snapshot: `packages/core/src/llm/providers.generated.ts`

Purpose: models.dev encodes intended provider SDKs via `provider.npm`. Grouping provider IDs by `npm` gives us a small transport/API-kind surface while provider IDs stay dynamic.

Related:
- Provider IDs snapshot: [`PROVIDER_COVERAGE.md`](./PROVIDER_COVERAGE.md)
- Direction rationale: [`UPDATED_DIRECTION.md`](./UPDATED_DIRECTION.md)

---

## 1) Summary

- models.dev providers: **97**
- unique `provider.npm` values: **23**
- Dexto overlays (non-models.dev): **6**
- total `LLM_PROVIDERS` in core: **103**

Two different coverage views matter:

1. **Current runtime wiring (today)**  
   `factory.ts` is still mostly provider-ID switch based, so only a subset of models.dev provider IDs are directly runnable today.

2. **Potential coverage with existing core dependencies (after transport mapping refactor)**  
   If we route by transport/API kind from `provider.npm`, we can cover **84 / 97** models.dev providers without adding new SDK packages.

---

## 2) Current vs potential coverage

### 2.1 Current provider-ID runtime coverage (today)

Directly wired models.dev providers in `packages/core/src/llm/services/factory.ts`:

```text
amazon-bedrock
anthropic
cohere
google
google-vertex
google-vertex-anthropic
groq
kimi-for-coding
minimax
minimax-cn
minimax-cn-coding-plan
minimax-coding-plan
moonshotai
moonshotai-cn
openai
openrouter
xai
zai
zai-coding-plan
zhipuai
zhipuai-coding-plan
```

This is why adding more providers currently risks more provider-ID branches (spaghetti) unless we pivot to transport/API-kind routing.

### 2.2 Potential coverage after transport/API-kind routing

With current `@dexto/core` dependencies and existing SDK surfaces, we can cover **84 / 97** models.dev providers by mapping:
- `provider.npm` → transport/API kind
- `provider.api` → baseURL (for compatible providers)
- SDK providerOptions namespace key (`openai`, `anthropic`, `google`, `bedrock`, `openrouter`, etc.)

Covered npm groups (no new dependencies):
- `@ai-sdk/openai-compatible` (67)
- `@ai-sdk/openai` (2)
- `@ai-sdk/anthropic` (7)
- `@ai-sdk/google` (1)
- `@ai-sdk/google-vertex` (1)
- `@ai-sdk/google-vertex/anthropic` (1)
- `@ai-sdk/groq` (1)
- `@ai-sdk/xai` (1)
- `@ai-sdk/cohere` (1)
- `@ai-sdk/amazon-bedrock` (1)
- `@openrouter/ai-sdk-provider` (1)

Not covered yet with current deps (13 providers / 12 npm values):
- `@ai-sdk/azure` (2)
- `@ai-sdk/cerebras` (1)
- `@ai-sdk/deepinfra` (1)
- `@ai-sdk/mistral` (1)
- `@ai-sdk/perplexity` (1)
- `@ai-sdk/togetherai` (1)
- `@ai-sdk/gateway` (1)
- `@ai-sdk/vercel` (1)
- `ai-gateway-provider` (1)
- `venice-ai-sdk-provider` (1)
- `@gitlab/gitlab-ai-provider` (1)
- `@jerome-benoit/sap-ai-provider-v2` (1)

---

## 3) Regression expectations for transport migration

When we migrate reasoning/runtime to transport/API-kind routing, minimum regression coverage should include:
- full mapping test over all generated providers (`providers.generated.ts`) with explicit unsupported buckets,
- reasoning profile/provider-options tests per transport family,
- gateway family exception tests (OpenRouter/`dexto-nova` exclusions and allowlists),
- factory creation tests that ensure `provider.npm` mapping picks the correct SDK path/options namespace.

---

## 4) Provider IDs grouped by `provider.npm` (current snapshot)

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

## @ai-sdk/openai-compatible (67)

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
evroc
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
meganova
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
opencode-go
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
