---
sidebar_position: 14
---

# Global Preferences

Global preferences allow you to configure system-wide settings for Dexto that apply across all agents and sessions. This is particularly useful for managing shared LLM configurations, default agents, and other user-level settings.

## Overview

Global preferences are stored in `~/.dexto/preferences.yml` and are created during the initial setup process via the `dexto setup` command. These preferences serve as defaults that can be automatically injected into agents when they are installed.

**Key Features:**
- **System-wide LLM configuration**: Set your preferred AI provider, model, and API key once
- **Default agent management**: Configure which agent to use when none is specified
- **Automatic preference injection**: New agents automatically inherit your global preferences
- **Setup tracking**: Tracks whether initial setup has been completed

## Preferences File Structure

### Type Definition

```typescript
export type GlobalPreferences = {
    llm: {
        provider: string;      // LLM provider (openai, anthropic, google, etc.)
        model: string;         // Model name for the provider
        apiKey: string;        // Environment variable reference (must start with $)
    };
    defaults: {
        defaultAgent: string;  // Default agent name for global CLI usage
    };
    setup: {
        completed: boolean;    // Whether initial setup has been completed
    };
};
```

### Complete Example

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

The `llm` section defines your global AI provider configuration. These settings are used as defaults for all agents unless overridden at the agent level.

**Required Fields:**

- **provider** (string): The LLM provider to use
  - Supported values: `openai`, `anthropic`, `google`, `groq`, `cohere`
  - See [Providers Guide](./llm/providers.md) for full list

- **model** (string): The model name for the selected provider
  - Must be a valid model for the chosen provider
  - Validation is performed during setup

- **apiKey** (string): Environment variable reference for the API key
  - **Must** be an environment variable reference (format: `$VARIABLE_NAME`)
  - Valid format: `^\$[A-Z_][A-Z0-9_]*$`
  - Examples: `$OPENAI_API_KEY`, `$ANTHROPIC_API_KEY`, `$GOOGLE_AI_KEY`

**Examples:**

```yaml
# OpenAI Configuration
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

```yaml
# Anthropic Configuration
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

```yaml
# Google Configuration
llm:
  provider: google
  model: gemini-2.0-flash
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

### Defaults Section

The `defaults` section specifies default behaviors for the Dexto CLI.

**Required Fields:**

- **defaultAgent** (string): The agent name to use when none is explicitly specified
  - Must be a valid agent name from the agent registry
  - Used by the global CLI when running `dexto` without specifying an agent
  - Common value: `default-agent`

**Example:**

```yaml
defaults:
  defaultAgent: default-agent
```

### Setup Section

The `setup` section tracks the completion status of the initial setup process.

**Fields:**

- **completed** (boolean): Whether the initial `dexto setup` has been completed
  - Defaults to `false`
  - Set to `true` after successful setup
  - Used to determine if the user needs to run setup

**Example:**

```yaml
setup:
  completed: true
```

## API Key Format Requirements

API keys in global preferences **must** be environment variable references, not literal API keys. This ensures security by keeping sensitive credentials out of configuration files.

**Valid Format:**
- Must start with `$`
- Followed by uppercase letters, numbers, or underscores
- First character after `$` must be a letter or underscore
- Regex pattern: `^\$[A-Z_][A-Z0-9_]*$`

**Valid Examples:**
```yaml
apiKey: $OPENAI_API_KEY           # ✓ Valid
apiKey: $ANTHROPIC_API_KEY        # ✓ Valid
apiKey: $MY_CUSTOM_KEY            # ✓ Valid
apiKey: $GOOGLE_AI_API_KEY_2      # ✓ Valid
```

**Invalid Examples:**
```yaml
apiKey: sk-proj-abc123...         # ✗ Literal API key (security risk)
apiKey: openai_api_key            # ✗ Missing $ prefix
apiKey: $openai_api_key           # ✗ Lowercase (must be uppercase)
apiKey: $123_API_KEY              # ✗ Cannot start with number
```

## Setup Command

The `dexto setup` command creates or updates your global preferences through an interactive or non-interactive process.

### Interactive Setup (Default)

```bash
dexto setup
```

This will guide you through:
1. Selecting an AI provider
2. Choosing a model
3. Configuring API keys
4. Setting up your default agent

### Non-Interactive Setup

```bash
dexto setup --provider anthropic --model claude-sonnet-4-5-20250929
```

**Options:**
- `--provider` - AI provider to use
- `--model` - Model name for the provider
- `--default-agent` - Default agent name (defaults to `default-agent`)
- `--interactive` - Enable/disable interactive mode (default: `true`)
- `--force` - Overwrite existing setup without confirmation

### Re-running Setup

If you already have preferences configured:

- **Interactive mode**: You'll be asked to confirm before overwriting
- **Non-interactive mode**: Use `--force` flag to overwrite

```bash
# Interactive confirmation
dexto setup

# Force overwrite
dexto setup --provider openai --model gpt-5-mini --force
```

## How Preferences Work

### Agent Resolution Flow

When you run Dexto commands, the system uses a context-aware approach to determine which agent to use:

1. **Explicit agent specified**: Uses the specified agent
2. **Project context**: Looks for project-local agents first
3. **Global CLI context**: Uses `defaults.defaultAgent` from preferences
4. **No preferences**: Prompts to run `dexto setup`

### Preference Injection

When installing agents from the registry, global preferences are automatically injected into the agent's configuration:

```bash
# Install agent with preference injection (default)
dexto install code-helper

# The installed agent will automatically receive:
# - Your configured LLM provider
# - Your configured model
# - Your API key reference
```

**How it works:**

1. Agent is copied from the registry to `~/.dexto/agents/`
2. Global LLM preferences are written to the agent's config
3. Agent is ready to use with your preferred settings

**Disabling injection:**

```typescript
// When using the API programmatically
await registry.resolveAgent('code-helper', true, false); // autoInstall=true, injectPreferences=false
```

### Preference Precedence

When conflicts occur, settings are resolved with the following precedence (highest to lowest):

1. **CLI arguments**: Explicit overrides passed to commands
2. **Agent configuration**: Settings in the agent's YAML file
3. **Global preferences**: Settings from `~/.dexto/preferences.yml`

**Example:**

```yaml
# Global preferences
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
```

```yaml
# Agent configuration (takes precedence)
llm:
  provider: openai
  model: gpt-5-mini
```

```bash
# CLI override (highest precedence)
dexto --provider google --model gemini-2.0-flash
```

## File Location

Global preferences are always stored at:
```text
~/.dexto/preferences.yml
```

This location is determined by the `getDextoGlobalPath()` utility and is consistent across all execution contexts.

## Updating Preferences

### Manual Editing

You can manually edit `~/.dexto/preferences.yml`, but ensure:
- Valid YAML syntax
- API keys are environment variable references
- Provider and model are compatible
- All required fields are present

### Programmatic Updates

```typescript
import { updateGlobalPreferences } from '@dexto/core';

// Update LLM configuration
await updateGlobalPreferences({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: '$OPENAI_API_KEY'
    }
});

// Update default agent only
await updateGlobalPreferences({
    defaults: {
        defaultAgent: 'my-custom-agent'
    }
});
```

**Note**: The LLM section requires complete replacement (provider, model, and apiKey must all be provided together), while defaults and setup sections support partial updates.

### Re-run Setup

The simplest way to update preferences is to re-run setup:

```bash
dexto setup
```

## Validation and Error Handling

Preferences are validated using Zod schemas with strict validation:

### Common Validation Errors

**Invalid API Key Format:**
```text
API key must be environment variable reference (e.g., $OPENAI_API_KEY)
```
**Solution**: Use `$VARIABLE_NAME` format instead of literal keys

**Incompatible Model:**
```text
Model 'gpt-5' is not supported by provider 'anthropic'
```
**Solution**: Check [Providers Guide](./llm/providers.md) for valid model combinations

**Missing Required Fields:**
```text
defaults.defaultAgent is required
```
**Solution**: Ensure all required fields are present in the preferences file

### Setup Completion Checks

The CLI automatically checks if setup is required before running commands:

- **Missing preferences file**: Prompts to run `dexto setup`
- **Incomplete setup**: Checks `setup.completed` flag
- **Corrupted preferences**: Prompts to re-run setup
- **Invalid schema**: Provides detailed validation errors

## Best Practices

1. **Keep API keys in environment variables**: Never store literal API keys in preferences
2. **Use consistent environment variable naming**: Follow provider conventions (e.g., `$OPENAI_API_KEY`)
3. **Run setup after major changes**: Re-run `dexto setup` when switching primary providers
4. **Verify preferences after manual edits**: Run a Dexto command to validate your changes
5. **Use default agent consistently**: Set a reliable default agent for predictable CLI behavior

## Relationship to Agent Configuration

Global preferences and agent configurations work together:

- **Global preferences**: User-level defaults (stored in `~/.dexto/`)
- **Agent configurations**: Agent-specific settings (stored in `~/.dexto/agents/` or project directories)

When a new agent is installed, it **inherits** global preferences but can **override** them in its own configuration file. See [Agent Configuration](./agent-yml.md) for agent-level settings.

## Next Steps

- **Learn about agent configuration**: See [Agent YAML Configuration](./agent-yml.md)
- **Explore LLM providers**: Check the [Providers Guide](./llm/providers.md)
- **Install agents**: Use `dexto install <agent-name>` to add new agents
- **Configure system prompts**: Learn about [System Prompt Configuration](./systemPrompt.md)
