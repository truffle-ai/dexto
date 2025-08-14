---
sidebar_position: 2
---

# LLM Configuration

Large Language Models (LLMs) are the brain of your Dexto agents. This section covers everything you need to know about configuring LLMs for your agents.

## Overview

Dexto supports multiple LLM providers out-of-the-box via the Vercel AI SDK. You can also use any OpenAI SDK-compatible provider. You can easily switch between different models and providers without changing your application code.

## Quick Start

### Basic Configuration
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
```

### Environment Variables
Set API keys in your `.env` file:
```bash
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
GROQ_API_KEY=your_groq_key
```

## What's in This Section

### [Configuration Reference](./configuration)
Complete guide to all LLM configuration options including:
- Required and optional fields
- Provider-specific options
- Advanced settings

### [Supported Providers](./providers)
Detailed guide to all supported LLM providers:
- **Built-in providers**: OpenAI, Anthropic, Google, Groq, Cohere
- **Custom providers**: Azure OpenAI, OpenRouter, Together.ai, local models
- **Setup instructions** for each provider
- **Supported models** and their capabilities

## Key Concepts

### Providers vs Models
- **Provider**: The service hosting the LLM (e.g., OpenAI, Anthropic)
- **Model**: The specific AI model to use (e.g., gpt-4.1-mini, claude-3-5-sonnet)

### System Prompts
System prompts define how your agent behaves. See the [System Prompt Configuration](../systemPrompt) guide for details on simple strings and advanced contributor configurations.

### Routers
Dexto uses routers to handle LLM requests:
- **Vercel router** (default): Optimized for performance and reliability
- **In-built router**: Direct communication with providers

## Next Steps

1. **New to LLMs?** Start with the [Configuration Reference](./configuration) to understand the basics
2. **Looking for a specific provider?** Check the [Providers Guide](./providers) for setup instructions
3. **Building an agent?** Head to [Building with Dexto](../../../tutorials/index.md) for implementation patterns 