---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

## Prerequisites

- [Node.js](https://nodejs.org/en/download) >= 20.0.0 with npm.

**Optional:** An LLM API Key (not required for local models)
- [Get a Gemini Key](https://aistudio.google.com/apikey) (free option available)
- [Get a Groq Key](https://console.groq.com/keys) (free option available)
- [Get an OpenAI Key](https://platform.openai.com/api-keys)
- [Get a Claude Key](https://console.anthropic.com/settings/keys)

## 1. Install Dexto

Install Dexto using the native installer:

```bash
# macOS / Linux / WSL
curl -fsSL https://dexto.ai/install | sh

# Windows PowerShell
irm https://dexto.ai/install.ps1 | iex
```

The installer needs no admin rights and never prompts. It installs the `latest` release, verified against the npm registry checksum, into `~/.dexto/cli`, and puts `dexto` in `~/.local/bin` (Windows: `%USERPROFILE%\.dexto\bin`, added to your user PATH). Re-running it with the same version changes nothing.

To install the Dexto 2.0 beta, or any version or dist-tag, set `DEXTO_VERSION`:

```bash
curl -fsSL https://dexto.ai/install | DEXTO_VERSION=next sh
```

```powershell
$env:DEXTO_VERSION = 'next'; irm https://dexto.ai/install.ps1 | iex
```

The last line of output is one JSON object, `{"installed":{...}}` or `{"error":{...}}`. Exit codes: 0 success, 1 failure, 2 invalid input, 5 version not found. Run `curl -fsSL https://dexto.ai/install | sh -s -- --help` for all options.

### Upgrade

```bash
# latest
dexto upgrade

# pinned
dexto upgrade 1.6.8
```

### Uninstall CLI

```bash
# default: remove the CLI and keep your settings in ~/.dexto
dexto uninstall

# remove ~/.dexto too
dexto uninstall --purge
```

### PATH Troubleshooting

If you had an older npm global install, `dexto upgrade` automatically migrates it to native.

If your shell still resolves the wrong binary:

```bash
which -a dexto
```

Remove stale entries and run `dexto upgrade` again.

## 2. Choose a Model

`dexto` needs a model before the first chat. Either:

- **Sign in** with `dexto login` to use Dexto models on your organization's credits, or
- **Set a provider key** in your environment or `~/.dexto/.env`, such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`.

With neither, `dexto` points you to `dexto login`. Switch models anytime with `/model` in the interactive CLI.

### Supported Providers

| Category | Providers |
|----------|-----------|
| **Free Cloud** | Google Gemini, Groq |
| **Local (No API key)** | Local Models, Ollama (requires [Ollama](https://ollama.com) installed) |
| **Cloud** | OpenAI, Anthropic, xAI, Cohere |
| **Gateways** | OpenRouter, Glama, LiteLLM, OpenAI-Compatible |
| **Enterprise** | Google Vertex AI, AWS Bedrock |

## 3. Start Using Dexto

```bash
# Start the interactive CLI
dexto

# Run one headless task
dexto run "say hello"
```

:::tip CLI reference
For detailed information about all CLI commands, flags, and advanced usage patterns, check out our comprehensive **[CLI Guide](../guides/cli/overview)**.
:::

## Next Step: Build Your First Agent

Now that Dexto is installed, you're ready to create your first custom agent with its own configuration and capabilities.

Continue to the **[Build Your First Agent Tutorial](./build-first-agent-tutorial.mdx)** to learn how to build agents using declarative configuration.
