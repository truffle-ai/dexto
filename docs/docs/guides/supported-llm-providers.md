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

## Cloud Platform Providers

### Amazon Bedrock

Access Claude, Nova, Llama, Mistral, and more through AWS:

```yaml
llm:
  provider: bedrock
  model: anthropic.claude-sonnet-4-5-20250929-v1:0
```

**Claude models:**
- `anthropic.claude-sonnet-4-5-20250929-v1:0` (default), `anthropic.claude-haiku-4-5-20251001-v1:0`, `anthropic.claude-opus-4-5-20251101-v1:0`

**Amazon Nova models:**
- `amazon.nova-premier-v1:0`, `amazon.nova-pro-v1:0`, `amazon.nova-lite-v1:0`, `amazon.nova-micro-v1:0`

**Other models:**
- `openai.gpt-oss-120b-1:0`, `openai.gpt-oss-20b-1:0`
- `qwen.qwen3-coder-30b-a3b-v1:0`, `qwen.qwen3-coder-480b-a35b-v1:0`

**Features:** Enterprise security, AWS billing, access to Claude/Nova/GPT-OSS/Qwen

<details>
<summary>Setup Instructions</summary>

1. Create an AWS account and enable Bedrock in your region
2. Request model access in [AWS Console → Bedrock → Model access](https://console.aws.amazon.com/bedrock/home#/modelaccess)

**Option 1: API Key (Recommended for development)**

Generate a Bedrock API key directly from the console - no IAM setup required:

1. Go to [AWS Console → Bedrock → API keys](https://console.aws.amazon.com/bedrock/home#/api-keys)
2. Click "Generate API Key" and copy the key
3. Set environment variables:
   ```bash
   export AWS_REGION="us-east-1"
   export AWS_BEARER_TOKEN_BEDROCK="your-api-key"
   ```

**Option 2: IAM Credentials (Recommended for production)**

1. Create IAM credentials with `bedrock:InvokeModel` permission
2. Set environment variables:
   ```bash
   export AWS_REGION="us-east-1"
   export AWS_ACCESS_KEY_ID="your-access-key"
   export AWS_SECRET_ACCESS_KEY="your-secret-key"
   # Optional: for temporary credentials
   export AWS_SESSION_TOKEN="your-session-token"
   ```

**Cross-region inference:** Dexto auto-detects and adds the appropriate region prefix (`eu.` or `us.`) based on your `AWS_REGION`. You can override by using explicit prefixed model IDs (e.g., `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`).

</details>

:::tip Custom Model IDs
Need a model not in our registry (e.g., new preview models)?
- **CLI**: `/model` → "Add Custom Model" → AWS Bedrock
- **WebUI**: Model picker → "+" → AWS Bedrock

Uses AWS credentials from your environment.
Set `AWS_REGION` and either `AWS_BEARER_TOKEN_BEDROCK` or IAM credentials as explained above.
:::

---

### Google Cloud Vertex AI

Access Google's Gemini and Anthropic's Claude models through Google Cloud Platform:

```yaml
llm:
  provider: vertex
  model: gemini-2.5-pro
```

**Gemini models:**
- `gemini-3-flash-preview`, `gemini-3-pro-preview` (Preview)
- `gemini-2.5-pro` (default), `gemini-2.5-flash`
- `gemini-2.0-flash`

**Claude models on Vertex:**
- `claude-opus-4-5@20251101`, `claude-sonnet-4-5@20250929`, `claude-haiku-4-5@20251001`
- `claude-opus-4-1@20250805`, `claude-opus-4@20250514`, `claude-sonnet-4@20250514`
- `claude-3-7-sonnet@20250219`, `claude-3-5-sonnet-v2@20241022`, `claude-3-5-haiku@20241022`

**Features:** Enterprise security, unified billing through GCP, access to both Gemini and Claude

**Authentication:** Uses Google Cloud Application Default Credentials (ADC), not API keys.

<details>
<summary>Setup Instructions</summary>

**Option 1: Service Account Key (Recommended for production)**

1. Go to [Google Cloud Console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create a service account with **Vertex AI User** role
3. Create and download a JSON key
4. Set environment variables:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
   export GOOGLE_VERTEX_PROJECT="your-project-id"
   # Optional: defaults to us-central1 for Gemini, us-east5 for Claude
   export GOOGLE_VERTEX_LOCATION="us-central1"
   ```

**Option 2: gcloud CLI (For local development)**

1. Install [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
2. Run: `gcloud auth application-default login`
3. Set: `export GOOGLE_VERTEX_PROJECT="your-project-id"`

**For Claude models:** Enable them in [Vertex AI Model Garden](https://console.cloud.google.com/vertex-ai/model-garden)

</details>

---

## Gateway Providers

### OpenRouter

Access 100+ models through one API:

```yaml
llm:
  provider: openrouter
  model: anthropic/claude-sonnet-4-5-20250929
  apiKey: $OPENROUTER_API_KEY
```

**Popular models:**
- `anthropic/claude-sonnet-4-5-20250929`
- `meta-llama/llama-3.1-405b-instruct`
- `google/gemini-pro-1.5`
- `mistralai/mistral-large`

**Features:** Single API for 100+ models, automatic model validation, unified billing

**Learn more:** [openrouter.ai](https://openrouter.ai/)

:::tip Adding Models Not in Registry
Can't find your model? Add any OpenRouter model via the custom model wizard:
- **CLI**: `/model` → "Add Custom Model" → OpenRouter
- **WebUI**: Model picker → "+" → OpenRouter

Model IDs are validated against OpenRouter's registry automatically.
:::

---

### LiteLLM

Unified proxy for 100+ LLM providers. Host your own LiteLLM proxy to access multiple providers through a single interface:

```yaml
llm:
  provider: litellm
  model: gpt-4
  apiKey: $LITELLM_API_KEY
  baseURL: http://localhost:4000
```

**Features:**
- Single API for OpenAI, Anthropic, AWS Bedrock, Azure, Vertex AI, and more
- Load balancing and fallbacks
- Cost tracking and rate limiting
- Self-hosted for full control

**Model naming:** Model names follow LiteLLM's format (e.g., `gpt-4`, `claude-3-sonnet`, `bedrock/anthropic.claude-v2`)

**Learn more:** [docs.litellm.ai](https://docs.litellm.ai/)

:::tip Adding Custom Models
Your LiteLLM proxy supports more models than our picker shows:
- **CLI**: `/model` → "Add Custom Model" → LiteLLM
- **WebUI**: Model picker → "+" → LiteLLM

Enter any model your proxy supports, plus your proxy URL.
:::

---

### Glama

OpenAI-compatible gateway providing unified access to multiple LLM providers with single billing:

```yaml
llm:
  provider: glama
  model: openai/gpt-4o
  apiKey: $GLAMA_API_KEY
```

**Features:**
- Single API for OpenAI, Anthropic, Google, and more
- Unified billing across providers
- No base URL configuration needed (fixed endpoint)

**Model naming:** Format is `provider/model` (e.g., `openai/gpt-4o`, `anthropic/claude-3-sonnet`)

**Learn more:** [glama.ai](https://glama.ai/)

:::tip Adding Custom Models
Need a model not in our picker?
- **CLI**: `/model` → "Add Custom Model" → Glama
- **WebUI**: Model picker → "+" → Glama

Model IDs use `provider/model` format (e.g., `openai/gpt-4o`).
:::

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

:::tip Adding Custom Models via CLI/WebUI
Need to add a local model or custom endpoint?
- **CLI**: `/model` → "Add Custom Model" → OpenAI-Compatible
- **WebUI**: Model picker → "+" → OpenAI-Compatible

Enter model name and base URL (e.g., `http://localhost:11434/v1` for Ollama).
:::

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

# Google Cloud Vertex AI (uses ADC, not API keys)
GOOGLE_VERTEX_PROJECT=your_gcp_project_id
GOOGLE_VERTEX_LOCATION=us-central1  # Optional
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  # For service account auth

# Amazon Bedrock
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=your_bedrock_api_key  # Option 1: API key (simplest)
# OR use IAM credentials (Option 2):
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_SESSION_TOKEN=your_session_token  # Optional, for temporary credentials

# Gateway providers
OPENROUTER_API_KEY=your_openrouter_key
LITELLM_API_KEY=your_litellm_key
GLAMA_API_KEY=your_glama_key

# OpenAI-compatible providers
TOGETHER_API_KEY=your_together_key
AZURE_OPENAI_API_KEY=your_azure_key
PERPLEXITY_API_KEY=your_perplexity_key
```
