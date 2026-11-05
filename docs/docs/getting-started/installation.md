---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

## Install and check your account

Use Node.js 22 with npm (the declared minimum is Node.js 20). `@next` selects the
Dexto 2.0 beta; `@latest` selects 1.x. Install once:

```sh
npm install -g dexto@next && echo 'Next: dexto login --device'
```

Then run `dexto login --device`. Show the person its URL and code and wait for them to approve.
Do not approve sign-in on their behalf. Check the first account result:

```sh
dexto whoami --json
```

Success is exit 0 with your account identity. Signed-out account commands exit 3 with
`needs_sign_in`; for a headless machine, run `dexto login --device` and retry. Installation and
`dexto --version` need no sign-in. Account and workspace requests do; model runs also need a
configured model or credits. This check starts no model run.

### Alternative: native installer

```sh
curl -fsSL https://dexto.ai/install | sh -s -- --version next
```

```powershell
$env:DEXTO_VERSION = 'next'; irm https://dexto.ai/install.ps1 | iex
```

The installer needs Node.js and npm, verifies the registry checksum, and installs without admin
rights under `~/.dexto/cli`. Add its printed bin directory to PATH (`~/.local/bin` on Unix;
`%USERPROFILE%\.dexto\bin` on Windows). Then run `dexto login --device` and `dexto whoami --json`.
The default is `latest` for 1.x upgrades; explicitly select `next` for 2.0.
Use `dexto upgrade next` to update a script install. Update npm installs with `npm install -g dexto@next`.

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

| Category               | Providers                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| **Free Cloud**         | Google Gemini, Groq                                                    |
| **Local (No API key)** | Local Models, Ollama (requires [Ollama](https://ollama.com) installed) |
| **Cloud**              | OpenAI, Anthropic, xAI, Cohere                                         |
| **Gateways**           | OpenRouter, Glama, LiteLLM, OpenAI-Compatible                          |
| **Enterprise**         | Google Vertex AI, AWS Bedrock                                          |

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
