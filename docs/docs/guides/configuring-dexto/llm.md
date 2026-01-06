---
sidebar_position: 3
sidebar_label: "LLM Configuration"
---

# LLM Configuration

Configure the language model provider and settings for your Dexto agent.

:::tip Complete Reference
For supported providers and models, see **[Supported LLM Providers](../supported-llm-providers.md)**.

For complete field documentation, see **[agent.yml → LLM Configuration](./agent-yml.md#llm-configuration)**.
:::

:::info Interactive Model Switching
Prefer not to edit YAML? Switch models interactively during a session:
- **CLI**: Type `/model` to open the model picker
- **WebUI**: Click the model name in the header

Custom models can also be added through the interactive wizard.
:::

## Overview

Large Language Models (LLMs) are the brain of your Dexto agents. Dexto supports multiple LLM providers out-of-the-box, including OpenAI, Anthropic, Google, and other OpenAI SDK-compatible providers.

## Basic Configuration

### Minimal Example

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

### Common Providers

**OpenAI:**
```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

**Anthropic:**
```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

**Google:**
```yaml
llm:
  provider: google
  model: gemini-2.5-pro
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

## Configuration Options

### Required Fields

- **provider** - LLM provider name
  - Built-in: `openai`, `anthropic`, `google`, `xai`, `groq`, `cohere`
  - Cloud platforms: `vertex` (Google Cloud), `bedrock` (AWS)
  - Gateways: `openrouter`, `litellm`, `glama`
  - Custom: `openai-compatible`
- **model** - Model identifier for the provider
- **apiKey** - API key or environment variable (not required for `vertex` or `bedrock`)

### Optional Fields

- **baseURL** - Custom API endpoint for OpenAI-compatible providers
- **maxInputTokens** - Maximum tokens for input context (when crossed, messages are compressed)
- **maxOutputTokens** - Maximum tokens for AI response generation
- **temperature** - Controls randomness (0 = deterministic, 1 = very creative)
- **maxIterations** - Maximum tool execution iterations (default: 50)

## Advanced Configuration

### Custom Providers

Use OpenAI-compatible providers:

```yaml
llm:
  provider: openai-compatible
  model: your-custom-model
  apiKey: $YOUR_API_KEY
  baseURL: https://api.your-provider.com/v1
  maxInputTokens: 100000
```

### Local Models

Run models locally using Ollama:

```yaml
llm:
  provider: openai-compatible
  model: llama3.2
  apiKey: dummy
  baseURL: http://localhost:11434/v1
  maxInputTokens: 8000
```

### Gateway Providers

**OpenRouter:**
```yaml
llm:
  provider: openrouter
  model: anthropic/claude-sonnet-4-5-20250929
  apiKey: $OPENROUTER_API_KEY
```

**Glama:**
```yaml
llm:
  provider: glama
  model: openai/gpt-4o
  apiKey: $GLAMA_API_KEY
```

**LiteLLM (self-hosted proxy):**
```yaml
llm:
  provider: litellm
  model: gpt-4
  apiKey: $LITELLM_API_KEY
  baseURL: http://localhost:4000
```

### Google Cloud Vertex AI

Access Gemini and Claude models through GCP:

```yaml
llm:
  provider: vertex
  model: gemini-2.5-pro
```

Vertex uses Application Default Credentials (ADC), not API keys. Set these environment variables:
- `GOOGLE_VERTEX_PROJECT` - Your GCP project ID (required)
- `GOOGLE_VERTEX_LOCATION` - Region (optional, defaults to us-central1)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account JSON (for production)

### Amazon Bedrock

Access Claude, Nova, Llama, and Mistral models through AWS:

```yaml
llm:
  provider: bedrock
  model: anthropic.claude-sonnet-4-5-20250929-v1:0
```

**Authentication options:**

**Option 1: API Key (simplest)**
- `AWS_REGION` - AWS region (required, e.g., us-east-1)
- `AWS_BEARER_TOKEN_BEDROCK` - Bedrock API key ([generate here](https://console.aws.amazon.com/bedrock/home#/api-keys))

**Option 2: IAM Credentials (for production)**
- `AWS_REGION` - AWS region (required, e.g., us-east-1)
- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- `AWS_SESSION_TOKEN` - Session token (optional, for temporary credentials)

### Token Control

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
  maxInputTokens: 100000   # Compress history when exceeding
  maxOutputTokens: 4000    # Limit response length
  temperature: 0.7
```

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
```

## Best Practices

1. **Use environment variables** - Store API keys as `$VAR` references
2. **Set appropriate token limits** - Control context and response length
3. **Test locally first** - Use local models for development before production
