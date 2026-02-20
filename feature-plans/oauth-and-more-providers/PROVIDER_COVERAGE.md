# Provider Coverage Snapshot (Dexto vs OpenClaw vs OpenCode)

Date: **2026-02-18**

This file is a concrete snapshot of **provider IDs** across the three relevant codebases, so we can reason about “what can be supported” without hand-waving.

Notes:
- This is intentionally “flat”: it lists IDs, not UX, auth methods, or transports.
- OpenCode’s list is primarily **models.dev provider IDs** (which is why it’s huge).
- models.dev’s **gateway provider** catalogs (notably OpenRouter) can be intentionally curated; consumers like OpenCode will not necessarily show OpenRouter’s full live `/models` surface.
- OpenClaw and OpenCode can support additional “custom providers” via config; those are not enumerable and are not included here.

---

## Dexto (in this repo)

Source of truth: `packages/core/src/llm/types.ts` (`LLM_PROVIDERS`)

Count: **27**

```text
openai
openai-compatible
anthropic
google
groq
xai
cohere
dexto-nova
glama
glm
litellm
local
minimax
minimax-cn
minimax-coding-plan
minimax-cn-coding-plan
moonshotai
moonshotai-cn
ollama
openrouter
vertex
bedrock
kimi-for-coding
zhipuai
zhipuai-coding-plan
zai
zai-coding-plan
```

---

## OpenClaw (reference)

Primary sources:
- Provider IDs that show up in the **auth/profile/env resolution** surface: `~/Projects/external/openclaw/src/agents/model-auth.ts`
- Provider IDs that are **auto-added** into `models.json` when credentials exist: `~/Projects/external/openclaw/src/agents/models-config.providers.ts` (`resolveImplicitProviders()`)
- Provider normalization (aliases like `opencode-zen` → `opencode`, `qwen` → `qwen-portal`): `~/Projects/external/openclaw/src/agents/model-selection.ts` (`normalizeProviderId()`)

Count (LLM providers/backends): **36**

```text
amazon-bedrock
anthropic
cerebras
chutes
cloudflare-ai-gateway
deepgram
github-copilot
google
google-vertex
groq
huggingface
kimi-coding
litellm
lmstudio
minimax
minimax-cn
minimax-portal
mistral
moonshot
nvidia
ollama
opencode
openai
openai-codex
openrouter
qianfan
qwen-portal
synthetic
together
venice
vercel-ai-gateway
vllm
voyage
xai
xiaomi
zai
```

Additional “CLI backends” (OpenClaw-specific; not models.dev providers):

```text
claude-cli
codex-cli
```

---

## OpenCode (reference)

Source of truth (base list): models.dev provider IDs (as of 2026-02-18): `https://models.dev/api.json`

Additional OpenCode-specific provider IDs:
- OpenCode adds `github-copilot-enterprise` by cloning the models.dev `github-copilot` provider:
  - `~/Projects/external/opencode/packages/opencode/src/provider/provider.ts` (search for “Copilot Enterprise”)

Count (models.dev providers): **94**  
Count (OpenCode effective providers incl. enterprise): **95**

```text
302ai
abacus
aihubmix
alibaba
alibaba-cn
amazon-bedrock
anthropic
azure
azure-cognitive-services
bailing
baseten
berget
cerebras
chutes
cloudferro-sherlock
cloudflare-ai-gateway
cloudflare-workers-ai
cohere
cortecs
deepinfra
deepseek
fastrouter
fireworks-ai
firmware
friendli
github-copilot
github-copilot-enterprise
github-models
gitlab
google
google-vertex
google-vertex-anthropic
groq
helicone
huggingface
iflowcn
inception
inference
io-net
jiekou
kilo
kimi-for-coding
kuae-cloud-coding-plan
llama
lmstudio
lucidquery
minimax
minimax-cn
minimax-cn-coding-plan
minimax-coding-plan
mistral
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
openai
opencode
openrouter
ovhcloud
perplexity
poe
privatemode-ai
qihang-ai
qiniu-ai
requesty
sap-ai-core
scaleway
siliconflow
siliconflow-cn
stackit
stepfun
submodel
synthetic
togetherai
upstage
v0
venice
vercel
vivgrid
vultr
wandb
xai
xiaomi
zai
zai-coding-plan
zenmux
zhipuai
zhipuai-coding-plan
```
