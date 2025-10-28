---
sidebar_position: 2
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
  defaultAgent: default-agent

setup:
  completed: true
```

## Configuration Sections

### LLM Section

Global AI provider configuration used as defaults for all agents:

```yaml
llm:
  provider: openai          # openai, anthropic, google, groq, cohere
  model: gpt-5-mini         # Valid model for provider
  apiKey: $OPENAI_API_KEY   # Environment variable reference (required)
```

**Required fields:**
- **provider** - LLM provider name
- **model** - Model identifier for the provider
- **apiKey** - **Must** be environment variable reference (`$VAR_NAME`)

**API key format:**
- Must start with `$`
- Uppercase letters, numbers, underscores only
- Pattern: `^\$[A-Z_][A-Z0-9_]*$`

Valid: `$OPENAI_API_KEY`, `$ANTHROPIC_API_KEY`
Invalid: `sk-proj-...`, `openai_key`, `$lowercase`

### Defaults Section

Default CLI behavior:

```yaml
defaults:
  defaultAgent: default-agent  # Agent to use when none specified
```

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

## Best Practices

1. **Keep API keys in environment** - Never store literal keys
2. **Use consistent naming** - Follow provider conventions
3. **Run setup after changes** - Re-run when switching providers
4. **Verify after edits** - Run a command to validate changes
5. **Set reliable default agent** - For predictable CLI behavior

## File Location

Always at: `~/.dexto/preferences.yml`

## Updating Preferences

### Manual Editing

Edit `~/.dexto/preferences.yml` directly, ensuring:
- Valid YAML syntax
- API keys are environment variable references
- Provider and model are compatible
- All required fields present

### Programmatic Updates

```typescript
await updateGlobalPreferences({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: '$OPENAI_API_KEY'
    }
});
```

### Re-run Setup

```bash
dexto setup
```

## See Also

- [agent.yml Reference → Global Preferences](../configuring-dexto/agent-yml.md#global-preferences) - Complete field documentation
- [Agent Configuration Guide](../configuring-dexto/agent-yml.md) - Agent-level settings
- [CLI Overview](./overview.md) - Complete CLI command reference
