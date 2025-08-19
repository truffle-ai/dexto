---
sidebar_position: 3
---

# Supported Providers

Dexto supports multiple LLM providers out-of-the-box, plus the ability to use any OpenAI SDK-compatible provider.

## Default Providers

### **OpenAI**
```yaml
llm:
  provider: openai
  model: gpt-4.1-mini  # Default
  apiKey: $OPENAI_API_KEY
```

**Supported models**: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, `o3`, `o3-mini`, `o1`

### **Anthropic**
```yaml
llm:
  provider: anthropic
  model: claude-4-sonnet-20250514 # Default
  apiKey: $ANTHROPIC_API_KEY
```

**Supported models**: `claude-4-opus-20250514`, `claude-4-sonnet-20250514`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20240620`, `claude-3-haiku-20240307`, `claude-3-opus-20240229`, `claude-3-sonnet-20240229`

### **Google**
```yaml
llm:
  provider: google
  model: gemini-2.5-pro  # Default
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

**Supported models**: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-1.5-pro-latest`, `gemini-1.5-flash-latest`


### **xAI**
```yaml
llm:
  provider: xai
  model: grok-4  # Default
  apiKey: $XAI_API_KEY
```

**Supported models**: `grok-4`, `grok-3`, `grok-3-mini`

### **Groq**
```yaml
llm:
  provider: groq
  model: llama-3.3-70b-versatile  # Default
  apiKey: $GROQ_API_KEY
```

**Supported models**: `gemma-2-9b-it`, `llama-3.3-70b-versatile`

### **Cohere**
```yaml
llm:
  provider: cohere
  model: command-a-03-2025  # Default
  apiKey: $COHERE_API_KEY
```

**Supported models**: `command-a-03-2025, command-r-plus`, `command-r`, `command`, `command-light`


## OpenAI-Compatible Providers

You can use any provider that implements the OpenAI SDK interface by setting `provider: openai-compatible` and providing a custom `baseURL`:

```yaml
llm:
  provider: openai-compatible
  model: your-custom-model
  apiKey: $YOUR_API_KEY
  baseURL: https://api.your-provider.com/v1
  maxInputTokens: 100000  # Required for custom providers
```

### Popular Compatible Providers

#### **Local Models**
Run models locally using Ollama, LM Studio, or similar:

```yaml
llm:
  provider: openai-compatible
  model: gemma3n:e2b
  apiKey: dummy  # Required but ignored for local
  baseURL: http://localhost:11434/v1  # Ollama default
  maxInputTokens: 8000
```

**Popular local model options:**
- **Ollama**: Easy local model hosting
- **LM Studio**: User-friendly local interface
- **vLLM**: High-performance serving
- **TGI (Text Generation Inference)**: Hugging Face's serving solution

#### **Azure OpenAI**
```yaml
llm:
  provider: openai-compatible
  model: gpt-4
  apiKey: $AZURE_OPENAI_API_KEY
  baseURL: https://your-resource.openai.azure.com/openai/deployments/gpt-4
  maxInputTokens: 128000
```

**Setup notes:**
- Replace `your-resource` with your Azure resource name
- The model name should match your deployment name
- Supports all OpenAI models available in Azure

#### **OpenRouter**
Access 100+ models through one API:

```yaml
llm:
  provider: openai-compatible
  model: anthropic/claude-3.5-sonnet
  apiKey: $OPENROUTER_API_KEY
  baseURL: https://openrouter.ai/api/v1
  maxInputTokens: 200000
```

**Popular OpenRouter models:**
- `anthropic/claude-3.5-sonnet`
- `meta-llama/llama-3.1-405b-instruct`
- `google/gemini-pro-1.5`
- `mistralai/mistral-large`

#### **Together.ai**
```yaml
llm:
  provider: openai-compatible
  model: meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo
  apiKey: $TOGETHER_API_KEY
  baseURL: https://api.together.xyz/v1
  maxInputTokens: 8000
```

**Popular Together.ai models:**
- `meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo`
- `mistralai/Mixtral-8x7B-Instruct-v0.1`
- `NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO`

#### **Anyscale**
```yaml
llm:
  provider: openai-compatible
  model: meta-llama/Llama-2-70b-chat-hf
  apiKey: $ANYSCALE_API_KEY
  baseURL: https://api.endpoints.anyscale.com/v1
  maxInputTokens: 4000
```

#### **Perplexity**
```yaml
llm:
  provider: openai-compatible
  model: llama-3.1-sonar-huge-128k-online
  apiKey: $PERPLEXITY_API_KEY
  baseURL: https://api.perplexity.ai
  maxInputTokens: 128000
```

**Special feature**: Online models that can search the web in real-time.

## Environment Variables

Set API keys in your `.env` file:

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
ANYSCALE_API_KEY=your_anyscale_key
PERPLEXITY_API_KEY=your_perplexity_key
```

## Provider-Specific Features

### OpenAI
- **Function calling**: Excellent tool use capabilities
- **Streaming**: Real-time response streaming
- **Vision**: GPT-4o models support image inputs
- **JSON mode**: Structured output generation

### Anthropic
- **Large context**: Up to 200K tokens
- **Tool use**: Advanced function calling
- **Safety**: Built-in content filtering
- **Constitutional AI**: Helpful, harmless, honest responses

### Google
- **Multimodal**: Text, image, video, and audio inputs
- **Large context**: Up to 2M tokens
- **Fast inference**: Optimized for speed
- **Code generation**: Excellent programming capabilities

### Groq
- **Ultra-fast inference**: Fastest API responses
- **Cost-effective**: Competitive pricing
- **Open source models**: Access to Llama and other OSS models

### xAI
- **Grok models**: Access to xAI's Grok language models
- **State of the art**: Grok 4 is the leader in all benchmarks!
- **Real-time knowledge**: Trained on real-time data
- **Reasoning**: Strong performance on complex reasoning tasks

### Cohere
- **State-of-the-Art Performance**: Models like `Command A` (`command-a-03-2025`) excel at complex workflows, including Retrieval-Augmented Generation (RAG), tool use, and multilingual tasks. It is Cohere's most performant model with a 256k context window.
- **Optimized for Conversation**: Strong instruction-following and conversational capabilities suitable for chat applications.
- **Flexible and Scalable**: Offers a range of models, from the powerful `Command A` and `Command R+` to the fast and efficient `command-light`.

## Choosing the Right Provider

### For Development
- **OpenAI**: Best overall developer experience and documentation
- **Local models**: Free, private, and great for experimentation

### For Production
- **OpenAI**: Reliable, well-documented, extensive model selection
- **Anthropic**: Excellent for safety-critical applications
- **Google**: Best for multimodal and large context applications

### For Cost Optimization
- **Groq**: Fastest and often cheapest for compatible models
- **OpenRouter**: Compare prices across providers
- **Local hosting**: No per-token costs after setup

### For Privacy
- **Local models**: Complete data privacy
- **Azure OpenAI**: Enterprise-grade security and compliance

## Troubleshooting

### Common Issues

**Invalid API Key**
```yaml
# Make sure environment variable is set correctly
apiKey: $OPENAI_API_KEY  # Not: OPENAI_API_KEY
```

**Model Not Found**
- Check the model name exactly matches provider documentation
- Verify your API key has access to the requested model

**Rate Limiting**
- Built-in providers have automatic retry logic
- For custom providers, consider implementing retry logic

**Timeout Issues**
- Consider using a different model or provider
- Check your network connection and provider status

### Getting Help

1. **Check the model name**: Ensure it exactly matches the provider's documentation
2. **Verify API keys**: Make sure environment variables are properly set
3. **Test with curl**: Verify your API key works with direct API calls
4. **Check quotas**: Ensure you haven't exceeded rate limits or billing quotas

## Next Steps

- **Configure your chosen provider**: Use the [Configuration Reference](./configuration) for detailed setup
- **Start building**: Head to [Building with Dexto](../../../tutorials/index.md) to create your first agent
- **Add tools**: Learn about [MCP Server Configuration](../../../mcp/connecting-servers) to give your agent capabilities