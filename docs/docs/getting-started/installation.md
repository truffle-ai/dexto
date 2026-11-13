---
sidebar_position: 2
---

# Installation

This guide will walk you through installing the Dexto CLI and setting up your environment so you can start running agents.

## 1. Install and check your account

Node.js 20 or later works; 22 is recommended. Use npm. Install once:

```sh
npm install -g dexto
```

If npm fails with EACCES, don't use sudo; use the [install script](https://www.dexto.ai/docs/cli/#install-script)
(installs under `~/.dexto`, no admin).

`dexto login --device` prints a link and code on stderr, then waits for approval. Run it so you
can read its output while it waits, and pass both to the person.
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
curl -fsSL https://dexto.ai/install | sh
```

```powershell
irm https://dexto.ai/install.ps1 | iex
```

Node.js 20 or later works; 22 is recommended. The installer needs npm, verifies the registry checksum, and installs without admin
rights under `~/.dexto/cli`. Add its printed bin directory to PATH (`~/.local/bin` on Unix;
`%USERPROFILE%\.dexto\bin` on Windows). Then run `dexto login --device` and `dexto whoami --json`.
The default is `latest`, the current release. `next` is the prerelease channel and can be older than `latest`.
Use `dexto upgrade` to update a script install. Update npm installs with `npm install -g dexto`.

On macOS and Linux, when `~/.local/bin` is not on PATH and a global npm `dexto` is (as when 1.x runs
`dexto upgrade`), the installer removes the npm `dexto` and links the command into that npm bin
directory instead, so `dexto` keeps working. If it cannot remove the npm `dexto`, it leaves it alone and
links into `~/.local/bin`. Because npm owns that directory, a later `npm install -g dexto` may replace
the link, and `npm uninstall -g dexto` may remove it. If `dexto` stops working after either, run the
installer again.

### Uninstall CLI

```bash
# default: remove the CLI and keep your settings in ~/.dexto
dexto uninstall

# remove ~/.dexto too
dexto uninstall --purge
```

### PATH Troubleshooting

For npm installs, update with `npm install -g dexto`. For script installs, use `dexto upgrade`.

If your shell still resolves the wrong binary:

```bash
which -a dexto
```

Remove stale entries, then repeat the update command for your install method.

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
