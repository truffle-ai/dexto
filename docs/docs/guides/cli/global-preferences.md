---
sidebar_position: 10
---

# Global Preferences

Configure system-wide settings for Dexto that apply across all agents and sessions.

:::tip Complete Reference
For complete field documentation, validation rules, and API specifications, see **[agent.yml → Global Preferences](../configuring-dexto/agent-yml.md#global-preferences)**.
:::

## Overview

Global preferences are stored in `~/.dexto/preferences.yml` and provide system-wide defaults for LLM configuration, default agents, and setup status.

**Key features:**
- System-wide LLM configuration (provider, model, API key)
- Default agent management
- Automatic preference injection into new agents
- Setup completion tracking

## Preferences Structure

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

defaults:
  defaultAgent: coding-agent
  defaultMode: web  # web | cli | server | mcp

setup:
  completed: true
```

## Configuration Sections

### LLM Section

Global AI provider configuration used as defaults for all agents:

```yaml
llm:
  provider: openai          # See supported providers below
  model: gpt-5-mini         # Valid model for provider
  apiKey: $OPENAI_API_KEY   # Environment variable reference (not required for vertex)
```

**Supported providers:**
- **Built-in:** `openai`, `anthropic`, `google`, `groq`, `xai`, `cohere`
- **Cloud platforms:** `vertex` (Google Cloud), `bedrock` (AWS)
- **Gateways:** `openrouter`, `litellm`, `glama`
- **Custom:** `openai-compatible`

**Required fields:**
- **provider** - LLM provider name
- **model** - Model identifier for the provider
- **apiKey** - Environment variable reference (`$VAR_NAME`) - not required for `vertex` or `bedrock`

**API key format:**
- Must start with `$`
- Uppercase letters, numbers, underscores only
- Pattern: `^\$[A-Z_][A-Z0-9_]*$`

Valid: `$OPENAI_API_KEY`, `$ANTHROPIC_API_KEY`
Invalid: `sk-proj-...`, `openai_key`, `$lowercase`

### Defaults Section

Default CLI behavior and mode selection:

```yaml
defaults:
  defaultAgent: coding-agent  # Agent to use when none specified
  defaultMode: web            # Run mode when --mode flag not specified
```

**Fields:**
- **defaultAgent** - Agent name to use when no `--agent` flag is provided
- **defaultMode** - Run mode when no `--mode` flag is provided (default: `web`)
  - `cli` - Interactive terminal mode
  - `web` - Web UI mode (default)
  - `server` - API server mode
  - `mcp` - MCP server mode

### Setup Section

Setup completion tracking:

```yaml
setup:
  completed: true  # Whether initial setup has run
```

## Setup Command

Create or update preferences:

### Interactive Setup

```bash
dexto setup
```

Guides you through provider selection, model choice, and API key configuration.

### Non-Interactive Setup

```bash
dexto setup --provider anthropic --model claude-sonnet-4-5-20250929
```

**Options:**
- `--provider` - AI provider
- `--model` - Model name
- `--default-agent` - Default agent name
- `--force` - Overwrite existing setup
- `--interactive` - Enable/disable interactive mode

## How Preferences Work

### Agent Resolution Flow

1. **Explicit agent specified** - Uses the specified agent
2. **Project context** - Looks for project-local agents
3. **Global CLI context** - Uses `defaults.defaultAgent`
4. **No preferences** - Prompts to run `dexto setup`

### Preference Injection

When installing agents, global preferences are automatically injected:

```bash
dexto install code-helper
# Agent receives your LLM provider, model, and API key
```

### Preference Precedence

Highest to lowest:
1. **CLI arguments** - Explicit overrides
2. **Agent configuration** - Agent's YAML file
3. **Global preferences** - `~/.dexto/preferences.yml`

## Common Configurations

### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

### Anthropic

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

### Google

```yaml
llm:
  provider: google
  model: gemini-2.0-flash
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

### Google Cloud Vertex AI

```yaml
llm:
  provider: vertex
  model: gemini-2.5-pro
  # No apiKey needed - uses Application Default Credentials
```

Requires `GOOGLE_VERTEX_PROJECT` environment variable set to your GCP project ID.

### OpenRouter

```yaml
llm:
  provider: openrouter
  model: anthropic/claude-sonnet-4-5-20250929
  apiKey: $OPENROUTER_API_KEY
```

### Amazon Bedrock

```yaml
llm:
  provider: bedrock
  model: anthropic.claude-sonnet-4-5-20250929-v1:0
  # No apiKey needed - uses AWS credentials or Bedrock API key
```

Requires `AWS_REGION` plus either:
- `AWS_BEARER_TOKEN_BEDROCK` - Bedrock API key (simplest), or
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` - IAM credentials (for production)

## Best Practices

1. **Keep API keys in environment** - Never store literal keys
2. **Use consistent naming** - Follow provider conventions
3. **Run setup after changes** - Re-run when switching providers
4. **Verify after edits** - Run a command to validate changes
5. **Set reliable default agent** - For predictable CLI behavior
6. **Configure default mode** - Set `defaultMode: cli` if you prefer terminal interaction, or keep `defaultMode: web` for UI-first workflows

## File Location

Always at: `~/.dexto/preferences.yml`

## Updating Preferences

### Manual Editing

Edit `~/.dexto/preferences.yml` directly, ensuring:
- Valid YAML syntax
- API keys are environment variable references
- Provider and model are compatible
- All required fields present

### Re-run Setup

```bash
dexto setup
```

## See Also

- [agent.yml Reference → Global Preferences](../configuring-dexto/agent-yml.md#global-preferences) - Complete field documentation
- [Agent Configuration Guide](../configuring-dexto/agent-yml.md) - Agent-level settings
- [CLI Overview](./overview.md) - Complete CLI command reference
