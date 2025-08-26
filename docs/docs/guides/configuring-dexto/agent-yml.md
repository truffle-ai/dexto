---
sidebar_position: 9
sidebar_label: "Annotated agent.yml"
---
# agent.yml – Annotated Example

Below is a **canonical** configuration file with inline comments.  Adjust paths and credentials for your environment.

```yaml
systemPrompt: |
  You are a helpful AI assistant.

llm:                         # LLM configuration block
  provider: anthropic        # openai | anthropic | …
  model: claude-3-opus-20240229
  apiKey: $ANTHROPIC_API_KEY # env references expanded on load
  router: in-built           # message router strategy
  maxInputTokens: 100000     # optional override

mcpServers:                  # zero or more MCP servers
  filesystem:
    command: mcp-filesystem
    args: [ "/tmp" ]

internalTools:
  - search_history           # enable built-in tools

storage:
  database:
    type: sqlite
    path: .dexto/dexto.db
```

For advanced scenarios (multi-environment overrides, hot-reload) see `docs/guides/configuring-dexto/dynamic-changes.md`.