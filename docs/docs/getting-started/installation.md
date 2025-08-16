---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

### Prerequisites
- [Node.js](https://nodejs.org/en/download) >= 20.0.0
- An [OpenAI API Key](https://platform.openai.com/api-keys)

### 1. Install Dexto
Install Dexto globally using npm:

```bash
npm install -g dexto
```
This adds the `dexto` command to your system, giving you access to the agent runtime.

### 2. Set Your API Key
Dexto agents use Large Language Models. Set the API key(s) for your chosen provider(s):

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# Google Gemini
export GOOGLE_GENERATIVE_AI_API_KEY="AIza..."

# Groq
export GROQ_API_KEY="gsk_..."

# XAI
export XAI_API_KEY="xai_..."

# Cohere
export COHERE_API_KEY="cohere_..."
```

Dexto auto-detects keys based on provider selection (CLI flag `--model` can infer provider).

### 3. Verify Your Installation
Test your installation with a simple command:

```bash
dexto "What is the meaning of life?"
```

If you receive a response, your installation is successful and the runtime is working correctly.

## Next Step: Build Your First Agent
Now that Dexto is installed, you're ready to create your first custom agent with its own configuration and capabilities.

Continue to the **[First Agent Tutorial](./first-agent-tutorial.md)** to learn how to build agents using declarative configuration. 