---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

## Prerequisites

- [Node.js](https://nodejs.org/en/download) >= 20.0.0

**Optional:** An LLM API Key (not required for local models)
- [Get a Gemini Key](https://aistudio.google.com/apikey) (free option available)
- [Get a Groq Key](https://console.groq.com/keys) (free option available)
- [Get an OpenAI Key](https://platform.openai.com/api-keys)
- [Get a Claude Key](https://console.anthropic.com/settings/keys)

## 1. Install Dexto

Install Dexto globally using npm:

```bash
npm install -g dexto
```

This adds the `dexto` command to your system, giving you access to the agent runtime.

## 2. Run Setup

```bash
dexto
```

This triggers the first-time setup wizard.

### Quick Start (Recommended)

1. **Choose setup type** → Select "Get started now"
2. **Pick provider** → Gemini (free), Groq (fast), or Local
3. **Get API key** → Browser opens, or paste existing key
4. **Confirm mode** → Press Enter for Terminal (default)

Done! You're ready to chat.

### Custom Setup

1. **Choose "Choose my own provider"**
2. **Browse providers** → OpenAI, Anthropic, local models, gateways
3. **Select model** → Pick from available models
4. **Configure API key** → Browser, paste, or skip
5. **Choose default mode** → Terminal, Browser, or API Server

### Supported Providers

| Category | Providers |
|----------|-----------|
| **Free Cloud** | Google Gemini, Groq |
| **Local (No API key)** | Local Models (uses node-llama-cpp), Ollama (requires [Ollama](https://ollama.com) installed) |
| **Cloud** | OpenAI, Anthropic, xAI, Cohere |
| **Gateways** | OpenRouter, Glama, LiteLLM, OpenAI-Compatible |
| **Enterprise** | Google Vertex AI, AWS Bedrock |

### Modes Explained

| Mode | Description | Best For |
|------|-------------|----------|
| **Terminal** | Interactive CLI in your terminal | Quick tasks, coding |
| **Browser** | Web UI at localhost:3000 | Long conversations |
| **API Server** | REST API on port 3001 | Integrations, apps |

## 3. Start Using Dexto

After setup, Dexto launches in your selected default mode.

```bash
# Run with your default mode
dexto

# Override with a specific mode
dexto --mode cli
dexto --mode web
dexto --mode server

# One-shot commands (auto-uses CLI mode)
dexto "say hello"
dexto -p "list files in this directory"
```

## Reconfigure Anytime

```bash
# Open settings menu
dexto setup

# Force re-run full setup
dexto setup --force
```

### Non-Interactive Setup

For automation or CI environments:

```bash
dexto setup --provider google --model gemini-2.5-pro
dexto setup --provider ollama --model llama3.2
dexto setup --quick-start
```

:::tip CLI reference
For detailed information about all CLI commands, flags, and advanced usage patterns, check out our comprehensive **[CLI Guide](../guides/cli/overview)**.
:::

## Next Step: Build Your First Agent

Now that Dexto is installed, you're ready to create your first custom agent with its own configuration and capabilities.

Continue to the **[Build Your First Agent Tutorial](./build-first-agent-tutorial.mdx)** to learn how to build agents using declarative configuration.
