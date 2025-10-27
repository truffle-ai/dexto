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

## Overview

Large Language Models (LLMs) are the brain of your Dexto agents. Dexto supports multiple LLM providers out-of-the-box via the Vercel AI SDK, and you can use any OpenAI SDK-compatible provider.

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

- **provider** - LLM provider name (openai, anthropic, google, xai, groq, cohere, openai-compatible)
- **model** - Model identifier for the provider
- **apiKey** - API key or environment variable (e.g., `$OPENAI_API_KEY`)

### Optional Fields

- **baseURL** - Custom API endpoint for OpenAI-compatible providers
- **maxInputTokens** - Maximum tokens for input context (when crossed, messages are compressed)
- **maxOutputTokens** - Maximum tokens for AI response generation
- **temperature** - Controls randomness (0 = deterministic, 1 = very creative)
- **router** - Choose between `vercel` (default) or `in-built` routers
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
  router: in-built
```

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

## Router Configuration

### Vercel Router (Default)

```yaml
llm:
  router: vercel  # Optional - this is the default
```

**Benefits:** Optimized for performance, built-in error handling, better streaming

### In-built Router

```yaml
llm:
  router: in-built
```

**When to use:** Direct control, custom providers, debugging, **required for GPT-5 models**

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
3. **Choose the right router** - Vercel for most cases, in-built for GPT-5 or custom providers
4. **Test locally first** - Use local models for development before production
