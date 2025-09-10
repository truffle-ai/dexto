---
sidebar_position: 1
title: Contributing to Dexto
description: Learn how to contribute MCPs, example agents, and other improvements to the Dexto ecosystem.
---

# Contributing to Dexto

We welcome contributions that help expand Dexto's ecosystem! This guide covers the most impactful ways to contribute: adding new MCPs to our registry, creating example agents, and requesting pre-installed agent status.

## Quick Start

1. **Fork and clone** the repository
2. **Choose your contribution type**:
   - [Add a new MCP to the WebUI registry](#adding-mcps-to-the-webui-registry)
   - [Create an example agent](#creating-example-agents)
   - [Request pre-installed agent status](#requesting-pre-installed-agent-status)
3. **Follow the guidelines** below for your chosen contribution type
4. **Submit a pull request** with your changes

## Adding MCPs to the WebUI Registry

Help other users discover and use new MCP servers by adding them to our built-in registry.

### How It Works

The WebUI registry is stored in `src/app/webui/lib/server-registry-data.json`. When users open the WebUI, they can browse and install MCPs directly from this registry.

### Step-by-Step Guide

1. **Edit the registry file**:
   ```bash
   # Navigate to the registry file
   vim src/app/webui/lib/server-registry-data.json
   ```

2. **Add your MCP entry** following this structure:
   ```json
   {
     "id": "unique-server-id",
     "name": "Display Name",
     "description": "Brief description of what this server does",
     "category": "productivity|research|creative|development|data|communication",
     "icon": "📁",
     "config": {
       "type": "stdio|http|sse",
       "command": "npx|uvx|python",
       "args": ["-y", "package-name"],
       "env": {
         "API_KEY": ""
       },
       "timeout": 30000
     },
     "tags": ["tag1", "tag2"],
     "isOfficial": false,
     "isInstalled": false,
     "requirements": {
       "platform": "all|windows|mac|linux",
       "node": ">=20.0.0",
       "python": ">=3.10"
     },
     "author": "Your Name",
     "homepage": "https://github.com/your-repo",
     "matchIds": ["server-id"]
   }
   ```

### Categories

Choose the most appropriate category for your MCP:

- **`productivity`** - File operations, task management, workflow tools
- **`research`** - Search, data analysis, information gathering  
- **`creative`** - Image editing, music creation, content generation
- **`development`** - Code analysis, debugging, development tools
- **`data`** - Data processing, analytics, databases
- **`communication`** - Email, messaging, collaboration tools

### Configuration Examples

#### Node.js MCP (stdio)
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "package-name"],
  "env": {
    "API_KEY": ""
  }
}
```

#### Python MCP (stdio)
```json
{
  "type": "stdio",
  "command": "uvx",
  "args": ["package-name"]
}
```

#### HTTP/SSE MCP
```json
{
  "type": "http",
  "baseUrl": "https://api.example.com/mcp"
}
```

### Best Practices

- **Test your MCP** before adding it to the registry
- **Provide clear descriptions** that explain what the MCP does
- **Use appropriate icons** (emojis work well)
- **Include all required environment variables** in the `env` section
- **Set realistic requirements** for platform and dependencies
- **Use descriptive tags** to help users find your MCP

## Creating Example Agents

Showcase how to use MCPs by creating example agents in the `agents/` directory.

### Directory Structure

Create a new directory for your agent:

```
agents/your-agent-name/
├── your-agent-name.yml    # Main configuration
├── README.md             # Setup and usage guide
└── data/                 # Optional: sample data
    └── example.json
```

### Configuration Template

Use this template for your agent configuration:

```yaml
# Your Agent Name
# Brief description of what this agent does

systemPrompt: |
  You are a [Agent Name] specialized in [purpose]. You have access to [MCP servers] that allow you to:
  
  ## Your Capabilities
  - [List key capabilities]
  - [More capabilities]
  
  ## How You Should Behave
  - [Behavior guidelines]
  - [Usage examples]

mcpServers:
  your-mcp:
    type: stdio
    command: npx
    args:
      - -y
      - "package-name"
    env:
      API_KEY: $YOUR_API_KEY

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    path: .dexto/database/your-agent.db
```

### README Template

Create a comprehensive README for your agent:

```markdown
# Your Agent Name

Brief description of what this agent does and why it's useful.

## Features
- Feature 1
- Feature 2

## Setup
1. Install dependencies: `npm install`
2. Set environment variables: `export YOUR_API_KEY=your-key`
3. Run the agent: `dexto --agent your-agent-name.yml`

## Usage Examples
- "Example command 1"
- "Example command 2"

## Requirements
- Node.js >= 20.0.0
- Your API key
```

### Example Agent Inspiration

Check out these existing example agents for inspiration:

- **Database Agent** (`agents/database-agent/`) - Natural language database operations
- **Linear Task Manager** (`agents/examples/linear-task-manager.yml`) - Project management integration
- **Triage System** (`agents/triage-demo/`) - Multi-agent customer support system

## Requesting Pre-installed Agent Status

For high-quality, widely-useful agents, you can request to have them added to our official agent registry.

### Process

1. **Create a comprehensive example agent** (following the guidelines above)
2. **Test it thoroughly** and document all features
3. **Open an issue** with the label `agent-registry-request`
4. **Include the following information**:
   - Link to your agent directory
   - Description of the agent's purpose and value
   - Screenshots or demos if applicable
   - Why it should be pre-installed

### Criteria for Pre-installed Agents

Your agent should:

- **Solve a common, well-defined problem**
- **Have clear documentation and examples**
- **Work reliably across different environments**
- **Provide significant value to the Dexto community**
- **Follow all coding standards and best practices**

### Benefits of Pre-installed Status

- **Wider visibility** - Your agent appears in the official registry
- **Community recognition** - Users can easily discover and use your work
- **Maintenance support** - We help maintain and update your agent
- **Documentation inclusion** - Your agent gets featured in our docs

## Development Guidelines

### Documentation

- Update relevant documentation in `/docs` folder
- Include clear examples in your contributions
- Follow the existing documentation structure

## Getting Help

- **GitHub Issues**: Open an issue for questions or discussions
- **Discord**: Join our community Discord for real-time help
- **Documentation**: Check existing docs for examples and patterns

## Recognition

Contributors who add MCPs or example agents will be:

- **Listed in our contributors section**
- **Mentioned in release notes** for significant contributions
- **Invited to our contributor program** for ongoing collaboration

Thank you for helping make Dexto better for everyone! 🚀
