---
sidebar_position: 1
title: "CLI & Configuration"
---

# Building Agents with CLI & Configuration

The fastest way to build AI agents with Dexto. Define your agent in YAML, run it with the CLI.

## Quick Start

### 1. Create an Agent Configuration

```yaml
# agents/my-agent.yml
systemPrompt: |
  You are a helpful assistant that can read and analyze files.

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

### 2. Run Your Agent

```bash
# Interactive CLI mode
dexto --agent agents/my-agent.yml

# Web UI mode
dexto --agent agents/my-agent.yml --mode web

# Single task execution
dexto --agent agents/my-agent.yml "List all TypeScript files in this project"
```

That's it! Your agent is running with filesystem access.

## Configuration Anatomy

Every agent configuration has three main sections:

```yaml
# 1. System Prompt - Defines agent behavior
systemPrompt: |
  You are a [role] that [capabilities].

  Your guidelines:
  - [Rule 1]
  - [Rule 2]

# 2. MCP Servers - Tools and capabilities
mcpServers:
  server_name:
    type: stdio | sse | http
    command: npx  # for stdio
    args: ["-y", "@package/name"]
    # OR
    url: http://localhost:8080  # for sse/http

# 3. LLM Configuration - Model settings
llm:
  provider: openai | anthropic | google | groq
  model: gpt-5-mini | claude-sonnet-4-5-20250929 | gemini-2.0-flash
  apiKey: $ENV_VAR_NAME
  temperature: 0.7  # optional
```

## Common Patterns

### Adding Multiple Tools

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

  web_search:
    type: stdio
    command: npx
    args: ["-y", "tavily-mcp@0.1.3"]
    env:
      TAVILY_API_KEY: $TAVILY_API_KEY

  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
```

### Environment-Specific Models

```yaml
# Development - faster, cheaper
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

# Production - more capable
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

### System Prompt from File

```yaml
systemPrompt:
  contributors:
    - id: base-prompt
      type: file
      files: ["./prompts/base-prompt.md"]

    - id: company-context
      type: file
      files: ["./docs/company-info.md"]
```

## CLI Commands

```bash
# Basic usage
dexto --agent <config.yml>

# Modes
dexto --agent <config.yml> --mode cli      # Interactive terminal (default)
dexto --agent <config.yml> --mode web      # Web UI + API server
dexto --agent <config.yml> --mode server   # Headless API server
dexto --agent <config.yml> --mode mcp      # Run as MCP server

# Options
dexto --agent <config.yml> --api-port 3001     # Custom API port
dexto --agent <config.yml> --web-port 3000     # Custom web port

# Single task (non-interactive)
dexto --agent <config.yml> "Your task here"
```

## What's Next?

- **[Example Agents](./examples/building-triage-system.md)** - Step-by-step tutorials for building real agents
- **[MCP Server Registry](../../mcp/overview.md)** - Browse available tools
- **[Configuration Guide](../../guides/configuring-dexto/overview.md)** - Deep dive into all options
- **[Dexto Agent SDK](../sdk/index.md)** - Switch to programmatic control when needed
