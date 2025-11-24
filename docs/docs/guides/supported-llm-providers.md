---
sidebar_position: 1
title: "Supported LLM Providers"
---

# Supported LLM Providers & Models

Dexto supports multiple LLM providers out-of-the-box, plus the ability to use any OpenAI SDK-compatible provider. This guide lists all supported providers and their available models.

:::tip Configuration Details
For complete LLM configuration options and YAML reference, see the [agent.yml → LLM Configuration](./configuring-dexto/agent-yml.md#llm-configuration) section.
:::

## Built-in Providers

### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

**Supported models:**
- `gpt-5.1-chat-latest`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`
- `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `gpt-5-codex`
- `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `gpt-4o`, `gpt-4o-mini`, `gpt-4o-audio-preview`
- `o4-mini`, `o3`, `o3-mini`, `o1`

**Features:** Function calling, streaming, vision (GPT-4o), JSON mode

---

### Anthropic (Claude)

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

**Supported models:**
- `claude-haiku-4-5-20251001`
- `claude-sonnet-4-5-20250929`
- `claude-opus-4-5-20251101`, `claude-opus-4-1-20250805`
- `claude-4-opus-20250514`, `claude-4-sonnet-20250514`
- `claude-3-7-sonnet-20250219`
- `claude-3-5-sonnet-20240620`
- `claude-3-5-haiku-20241022`

**Features:** Large context (200K tokens), advanced tool use, Constitutional AI

---

### Google Gemini

```yaml
llm:
  provider: google
  model: gemini-2.5-pro
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

**Supported models:**
- `gemini-3-pro-preview`, `gemini-3-pro-image-preview`
- `gemini-2.5-pro` (default), `gemini-2.5-flash`, `gemini-2.5-flash-lite`
- `gemini-2.0-flash`, `gemini-2.0-flash-lite`

**Features:** Multimodal (text/image/video/audio), large context (1M tokens), fast inference

---

### xAI (Grok)

```yaml
llm:
  provider: xai
  model: grok-4
  apiKey: $XAI_API_KEY
```

**Supported models:**
- `grok-4` (default)
- `grok-3`
- `grok-3-mini`
- `grok-code-fast-1`

**Features:** State-of-the-art reasoning, real-time knowledge, strong benchmark performance

---

### Groq

```yaml
llm:
  provider: groq
  model: llama-3.3-70b-versatile
  apiKey: $GROQ_API_KEY
```

**Supported models:**
- `llama-3.3-70b-versatile` (default)
- `gemma-2-9b-it`
- `openai/gpt-oss-20b`
- `openai/gpt-oss-120b`
- `moonshotai/kimi-k2-instruct`
- `meta-llama/llama-4-scout-17b-16e-instruct`
- `meta-llama/llama-4-maverick-17b-128e-instruct`
- `deepseek-r1-distill-llama-70b`
- `qwen/qwen3-32b`

**Features:** Ultra-fast inference, cost-effective, open source models

---

### Cohere

```yaml
llm:
  provider: cohere
  model: command-a-03-2025
  apiKey: $COHERE_API_KEY
```

**Supported models:**
- `command-a-03-2025` (default, 256k context window)
- `command-r-plus`
- `command-r`
- `command-r7b`

**Features:** RAG optimization, tool use, multilingual, conversational AI

---

## OpenAI-Compatible Providers

Use any provider that implements the OpenAI SDK interface:

```yaml
llm:
  provider: openai-compatible
  model: your-custom-model
  apiKey: $YOUR_API_KEY
  baseURL: https://api.your-provider.com/v1
  maxInputTokens: 100000
```

### Local Models

Run models locally using Ollama, LM Studio, or similar:

```yaml
llm:
  provider: openai-compatible
  model: gemma3n:e2b
  apiKey: dummy
  baseURL: http://localhost:11434/v1
  maxInputTokens: 8000
```

**Popular options:**
- **Ollama** - Easy local model hosting
- **LM Studio** - User-friendly interface
- **vLLM** - High-performance serving
- **TGI** - Hugging Face serving

---

### Azure OpenAI

```yaml
llm:
  provider: openai-compatible
  model: gpt-5
  apiKey: $AZURE_OPENAI_API_KEY
  baseURL: https://your-resource.openai.azure.com/openai/deployments/gpt-5
  maxInputTokens: 128000
```

**Notes:** Replace `your-resource` with your Azure resource name. Supports all OpenAI models available in Azure.

---

### OpenRouter

Access 100+ models through one API:

```yaml
llm:
  provider: openai-compatible
  model: anthropic/claude-sonnet-4-5-20250929
  apiKey: $OPENROUTER_API_KEY
  baseURL: https://openrouter.ai/api/v1
  maxInputTokens: 200000
```

**Popular models:**
- `anthropic/claude-sonnet-4-5-20250929`
- `meta-llama/llama-3.1-405b-instruct`
- `google/gemini-pro-1.5`
- `mistralai/mistral-large`

---

### Together.ai

```yaml
llm:
  provider: openai-compatible
  model: meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo
  apiKey: $TOGETHER_API_KEY
  baseURL: https://api.together.xyz/v1
  maxInputTokens: 8000
```

---

### Perplexity

```yaml
llm:
  provider: openai-compatible
  model: llama-3.1-sonar-huge-128k-online
  apiKey: $PERPLEXITY_API_KEY
  baseURL: https://api.perplexity.ai
  maxInputTokens: 128000
```

**Special feature:** Online models with real-time web search

---

## Choosing the Right Provider

### For Development
- **OpenAI** - Best developer experience and documentation
- **Local models** - Free, private, great for experimentation

### For Production
- **OpenAI** - Reliable, extensive model selection
- **Anthropic** - Safety-critical applications
- **Google** - Multimodal and large context needs

### For Cost Optimization
- **Groq** - Fastest and often cheapest
- **OpenRouter** - Compare prices across providers
- **Local hosting** - No per-token costs

### For Privacy
- **Local models** - Complete data privacy
- **Azure OpenAI** - Enterprise security and compliance

## Environment Variables

Set API keys in your `~/.dexto/.env` file:

```bash
# Built-in providers
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
GROQ_API_KEY=your_groq_key
XAI_API_KEY=your_xai_key
COHERE_API_KEY=your_cohere_key

# Custom providers
OPENROUTER_API_KEY=your_openrouter_key
TOGETHER_API_KEY=your_together_key
AZURE_OPENAI_API_KEY=your_azure_key
PERPLEXITY_API_KEY=your_perplexity_key
```
