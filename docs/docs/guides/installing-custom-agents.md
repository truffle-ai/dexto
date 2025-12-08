---
sidebar_position: 7
title: "Installing Custom Agents"
---

# Installing Custom Agents

Dexto makes it easy to install and use custom AI agents. Whether you're using pre-built agent templates from the registry or creating your own from scratch, this guide covers everything you need to know.

## What are Custom Agents?

Custom agents are specialized AI configurations tailored for specific tasks. They can include:
- **Custom system prompts** – Define the agent's personality and behavior
- **LLM settings** – Choose specific models and providers
- **Tools and MCP servers** – Enable specific capabilities
- **Memory and storage** – Configure how agents remember context

Dexto provides two ways to install custom agents:
1. **From the CLI** – Using `dexto install` command
2. **From the Web UI** – Using the "+New Agent" button

## Installing from CLI

### Installing Pre-built Agents from Registry

Dexto comes with a curated registry of agent templates ready to use:

```bash
# List available agents
dexto list-agents

# Install a specific agent
dexto install nano-banana-agent

# Install multiple agents at once
dexto install podcast-agent database-agent music-agent

# Install all available agents
dexto install --all
```

**Available agent templates include:**
- `nano-banana-agent` – Image generation and editing with Google Nano Banana
- `podcast-agent` – Podcast generation with multi-speaker TTS
- `database-agent` – SQL queries and database operations
- `image-editor-agent` – Image manipulation and editing
- `music-agent` – Music creation and audio processing
- `pdf-agent` – Document analysis and conversation
- `product-researcher` – Product naming and branding research
- `triage-agent` – Multi-agent customer support routing
- `workflow-builder-agent` – n8n workflow automation
- `product-analysis-agent` – PostHog product analytics
- `gaming-agent` – Play GameBoy games like Pokemon

### Installing from a Local File

You can install an agent from a local YAML configuration file:

```bash
dexto install ./my-agent.yml
```

Dexto will prompt you for metadata:
- **Agent ID** – Unique identifier (lowercase, hyphens only)
- **Agent Name** – Display name shown in UI
- **Description** – Brief description of what the agent does
- **Author** – Your name or organization
- **Tags** – Comma-separated categories

**Example:**
```bash
$ dexto install ./coding-assistant.yml

📝 Custom Agent Installation
Agent name: coding-assistant
Description: A specialized coding assistant with best practices
Author: Your Name
Tags (comma-separated): coding, development, productivity

✅ coding-assistant installed successfully
```

### Installing from a Directory

For more complex agents with multiple files (prompts, tools, resources):

```bash
dexto install ./my-complex-agent/
```

Dexto will ask for:
1. **Metadata** (same as file installation)
2. **Main config file** – Which YAML file is the entry point (e.g., `agent.yml`)

**Directory structure example:**
```
my-complex-agent/
├── agent.yml              # Main config (specified during install)
├── prompts/
│   ├── system.txt
│   └── examples.txt
└── tools/
    └── custom-tool.js
```

### Installation Options

**Force Reinstall:**
```bash
dexto install nano-banana-agent --force
```

**Skip Preference Injection:**
```bash
dexto install nano-banana-agent --no-inject-preferences
```

By default, Dexto injects your global preferences (like API keys from `~/.dexto/.env`) into installed agents. Use `--no-inject-preferences` to skip this.

## Installing from Web UI

The Web UI provides a visual way to create custom agents without writing YAML files.

### Steps to Create an Agent

1. **Open the Web UI:**
   ```bash
   dexto
   ```

2. **Click "+New Agent"** in the agent selector (top of the interface)

3. **Fill out the form:**

   **Basic Information:**
   - **Agent ID** – Unique identifier (e.g., `my-research-agent`)
   - **Agent Name** – Display name (e.g., `Research Assistant`)
   - **Description** – What the agent does
   - **Author** – Your name (optional)
   - **Tags** – Comma-separated (e.g., `research, analysis, custom`)

   **LLM Configuration:**
   - **Provider** – Choose from OpenAI, Anthropic, Google, etc.
   - **Model** – Select the specific model (e.g., `gpt-5`, `claude-sonnet-4-5`)
   - **API Key** – Enter your API key (stored securely in `~/.dexto/.env`)

   **System Prompt:**
   - Write the agent's instructions and behavior guidelines

4. **Click "Create Agent"**

The agent is immediately available in the agent switcher!

### Web UI Features

- **Visual Configuration** – No YAML syntax required
- **Secure Key Storage** – API keys are stored in `.dexto/.env` with environment variable references
- **Instant Availability** – Created agents appear immediately in all Dexto modes
- **Edit Later** – Use the "Edit Agent" button to modify configuration

## Where Agents are Stored

All installed agents (both CLI and Web UI) are stored in:

```
~/.dexto/agents/<agent-id>/
```

**For registry agents:**
```
~/.dexto/agents/nano-banana-agent/
└── nano-banana-agent.yml
```

**For custom agents:**
```
~/.dexto/agents/my-custom-agent/
├── agent.yml              # Main configuration
└── .registry-metadata.json # Installation metadata
```

## Using Installed Agents

### In Web UI (Default)

```bash
# Use default agent (opens Web UI)
dexto

# Use specific installed agent (opens Web UI)
dexto --agent nano-banana-agent
```

Use the agent selector dropdown (top of web UI) to switch between installed agents.

### In CLI Mode

```bash
# Use default agent in CLI
dexto --mode cli

# Use specific installed agent in CLI
dexto --agent nano-banana-agent --mode cli

# Switch LLM during CLI session
dexto --mode cli
> /model switch
```

### In Other Modes

```bash
# MCP server with custom agent
dexto --mode mcp --agent coding-assistant
```

## Managing Installed Agents

### List Installed Agents

```bash
# Show all agents (registry + installed)
dexto list-agents

# Show only installed agents
dexto list-agents --installed

# Show detailed information
dexto list-agents --verbose
```

### Find Agent Location

```bash
dexto which nano-banana-agent
# Output: /Users/you/.dexto/agents/nano-banana-agent/nano-banana-agent.yml
```

### Uninstall Agents

```bash
# Uninstall specific agent
dexto uninstall nano-banana-agent

# Uninstall multiple agents
dexto uninstall agent1 agent2 agent3

# Uninstall all agents
dexto uninstall --all
```

## Creating Your Own Agent Template

Want to create a shareable agent template? Here's the structure:

### Single-File Agent

**my-agent.yml:**
```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

systemPrompt: |
  You are a specialized assistant for data analysis.

  Your expertise includes:
  - Statistical analysis
  - Data visualization recommendations
  - Python/R code generation

  Always provide clear explanations alongside code.

memory:
  enabled: true
  maxTokens: 10000

tools:
  browserUse:
    enabled: true
  filesystem:
    enabled: true
```

Install with:
```bash
dexto install ./my-agent.yml
```

### Directory-Based Agent

For complex agents with multiple configuration files:

**project-manager-agent/**
```
project-manager-agent/
├── agent.yml              # Main config
├── prompts/
│   ├── system.md          # System prompt
│   └── examples.md        # Few-shot examples
├── mcp/
│   └── mcp-config.yml     # MCP server configurations
└── README.md              # Documentation
```

**agent.yml:**
```yaml
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY

systemPrompt:
  type: file
  path: ./prompts/system.md

mcp:
  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: $GITHUB_TOKEN
```

Install with:
```bash
dexto install ./project-manager-agent/
# When prompted for "Main config file:", enter: agent.yml
```

## Best Practices

### ✅ DO:

- **Use descriptive agent IDs** – `data-analysis-agent` not `agent1`
- **Write clear descriptions** – Help users understand the agent's purpose
- **Use environment variables for API keys** – Never hardcode secrets
- **Test thoroughly** – Try the agent in different scenarios
- **Document custom tools** – Explain any special configuration
- **Version your agents** – Use git for custom agent directories

### ❌ DON'T:

- **Don't use spaces in agent IDs** – Use kebab-case: `my-agent` not `my agent`
- **Don't hardcode API keys** – Use env vars: `$ANTHROPIC_API_KEY`
- **Don't override registry agents** – Choose unique IDs
- **Don't skip descriptions** – They help users find the right agent
- **Don't create overly complex configs** – Keep it simple and focused

## Troubleshooting

### Agent doesn't appear after installation

- Check installation completed successfully (look for ✅ message)
- Verify agent exists: `dexto which <agent-id>`
- Restart Dexto if in interactive mode
- Check `~/.dexto/agents/<agent-id>/` directory exists

### "Agent ID already exists" error

- The ID conflicts with a bundled agent or existing custom agent
- Choose a different, unique ID
- To reinstall, use `dexto install --force <agent>`

### API key not working

- Ensure the key is in `~/.dexto/.env`:
  ```
  OPENAI_API_KEY=sk-...
  ANTHROPIC_API_KEY=sk-ant-...
  ```
- Use the correct env var name in agent config: `$OPENAI_API_KEY`
- Run `dexto setup` to configure keys globally

### Custom agent YAML syntax errors

- Validate YAML syntax online or with a linter
- Check indentation (use 2 spaces, not tabs)
- Ensure all required fields are present
- See [agent configuration guide](./configuring-dexto/agent-yml.md) for valid schema

## Next Steps

- Learn about [agent configuration options](./configuring-dexto/agent-yml.md)
- Explore [MCP integration](../mcp/overview.md) for advanced tools
- Check out [system prompt configuration](./configuring-dexto/systemPrompt.md)
- Read about [LLM providers and models](./configuring-dexto/llm.md)
