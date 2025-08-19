---
sidebar_position: 1
---

# Configuration Reference

This page covers all the technical details of configuring LLMs in Dexto.

## Type Definition

```typescript
export type LLMConfig = {
    provider: string;
    model: string;
    apiKey: string;
    baseURL?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    temperature?: number;
    router?: 'vercel' | 'in-built';
    maxIterations?: number;
};

export type AgentConfig = {
    llm: LLMConfig;
    // ... other agent fields
};
```

## LLM Configuration Fields

### Required Fields

- **provider** (string): The LLM provider to use (e.g., `openai`, `anthropic`, `google`, `groq`, `cohere`)
- **model** (string): The model name (see [Providers Guide](./providers) for full list)
- **apiKey** (string): API key or environment variable (e.g., `$OPENAI_API_KEY`)

### Optional Fields

- **baseURL** (string): Custom API endpoint for OpenAI-compatible providers
- **maxInputTokens** (number): Maximum tokens for input context (when this is crossed, messages are compressed)
- **maxOutputTokens** (number): Maximum tokens for AI response generation
- **temperature** (number): Controls randomness in AI responses (0 = deterministic, 1 = very creative)
- **router** (string): Choose between `vercel` (default) or `in-built` routers
- **maxIterations** (number): Maximum number of tool execution iterations before stopping (prevents infinite loops)

## System Prompts

⚠️ **Important**: The `systemPrompt` field is configured at the agent level, not within the LLM configuration.

For detailed system prompt configuration, including simple strings and advanced contributor patterns, see the dedicated [System Prompt Configuration](../systemPrompt) guide.

## LLM Response Control

### Temperature Setting
Control the creativity/randomness of AI responses:

```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.7  # 0 = deterministic, 1 = very creative
```

### Token Limits

**Input Token Control (maxInputTokens)**
- Controls when conversation history gets compressed/truncated
- Useful for managing long conversations
- Defaults to model's maximum context window

**Output Token Control (maxOutputTokens)**
- Limits how long the AI's responses can be
- Prevents excessively long responses
- Provider-specific limits may apply

```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  maxInputTokens: 100000   # Compress history when exceeding this
  maxOutputTokens: 4000    # Limit response length
  temperature: 0.7
```

## Provider Examples

### OpenAI Configuration
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.7
  maxOutputTokens: 4000
```

### Anthropic Configuration
```yaml
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20240620
  apiKey: $ANTHROPIC_API_KEY
  temperature: 0.7
  maxOutputTokens: 8000
```

### Cohere Configuration
```yaml
llm:
  provider: cohere
  model: command-r-plus
  apiKey: $COHERE_API_KEY
  temperature: 0.7
  maxOutputTokens: 4096
```

### Google Configuration
```yaml
llm:
  provider: google
  model: gemini-2.0-flash
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
  temperature: 0.7
  maxOutputTokens: 8192
```

## Custom Providers

For OpenAI-compatible providers, you'll need additional configuration:

```yaml
llm:
  provider: openai
  model: your-custom-model
  apiKey: $YOUR_API_KEY
  baseURL: https://api.your-provider.com/v1
  maxInputTokens: 100000   # Required for custom providers
  maxOutputTokens: 4000
  temperature: 0.7
```

**Important Notes for Custom Providers:**
- Always set `provider: openai` for OpenAI-compatible APIs
- The `maxInputTokens` field is required when using `baseURL`
- Use `baseURL` to point to the custom endpoint

## Router Configuration

Dexto offers two router options:

### Vercel Router (Default)
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  router: vercel  # This is the default
```

**Benefits:**
- Optimized for performance and reliability
- Built-in error handling and retries
- Better streaming support

### In-built Router
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  router: in-built
```

**When to use:**
- Direct control over LLM communication
- Custom provider configurations
- Debugging provider issues
- **Required for GPT-5 models** (gpt-5, gpt-5-mini, gpt-5-nano)

> **Model-Specific Restrictions**: Some models have router restrictions. For example, GPT-5 models only support the `in-built` router. The system will automatically validate router compatibility and provide clear error messages if an incompatible router is selected.

## Complete Configuration Examples

### Production-Ready Configuration
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.3
  maxOutputTokens: 4000
```

### Local Development Configuration
```yaml
llm:
  provider: openai
  model: llama3.2
  apiKey: dummy
  baseURL: http://localhost:11434/v1
  maxInputTokens: 8000
  maxOutputTokens: 4000
  temperature: 0.7
  router: in-built
```

## Next Steps

- **Learn about providers**: Check the [Providers Guide](./providers) for specific setup instructions
- **Start building**: Head to [Building with Dexto](../../../tutorials/index.md) to put this configuration to use
- **Explore MCP**: Learn about [MCP Server Configuration](../../../mcp/connecting-servers) to add tools to your agents
