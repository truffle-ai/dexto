---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

### Prerequisites
- [Node.js](https://nodejs.org/en/download) >= 20.0.0
- An LLM API Key:
  -  [Get an OpenAI Key](https://platform.openai.com/api-keys)
  -  [Get a Gemini Key](https://aistudio.google.com/apikey)
  -  [Get a Claude Key](https://console.anthropic.com/settings/keys)
  -  [Get a Groq Key](https://console.groq.com/keys)

### 1. Install Dexto
Install Dexto globally using npm:

```bash
npm install -g dexto
```
This adds the `dexto` command to your system, giving you access to the agent runtime.

### 2. Run dexto for the first time

```bash
dexto
```

This triggers the first time setup, where you will be asked to set up your preferred Large Language Model (LLM) and enter the API key.

Once setup is complete, you should see a terminal UI open, you can now interact with your first dexto agent! Say hi!

Note: You can re-run the setup at any time with the command `dexto setup`

## Next Step: Build Your First Agent
Now that Dexto is installed, you're ready to create your first custom agent with its own configuration and capabilities.

Continue to the **[Build Your First Agent Tutorial](./build-first-agent-tutorial)** to learn how to build agents using declarative configuration. 
