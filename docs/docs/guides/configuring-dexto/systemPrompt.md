---
sidebar_position: 3
sidebar_label: "System Prompt"
---

# System Prompt Configuration

Configure how your Dexto agent behaves and responds through system prompts that define personality, capabilities, and guidelines.

:::tip Complete Reference
For complete field documentation and all configuration options, see **[agent.yml → System Prompt](./agent-yml.md#system-prompt-configuration)**.
:::

## Overview

System prompts define your agent's personality, behavior, and capabilities. They serve as the foundational instructions that guide how your agent interprets and responds to user requests.

You can use either a simple string for basic scenarios or an advanced multi-contributor system for complex agents that need dynamic context, file-based instructions, or memory integration.

**Key capabilities:**
- Static instructions for consistent behavior
- Dynamic context (date/time, MCP resources)
- File-based documentation inclusion
- User memory integration
- Priority-based content ordering

## Configuration Types

### Simple String Prompt

For straightforward agents, use a single string:

```yaml
systemPrompt: |
  You are a helpful AI assistant with access to tools.
  Use these tools when appropriate to answer user queries.
  After each tool result, determine if you need more information or can provide a final answer.
```

### Advanced Multi-Contributor System

For complex scenarios requiring multiple content sources:

```yaml
systemPrompt:
  contributors:
    - id: core-behavior
      type: static
      priority: 1
      content: |
        You are a professional software development assistant.
        You help with coding, documentation, and project management.

    - id: current-time
      type: dynamic
      priority: 10
      source: dateTime

    - id: project-docs
      type: file
      priority: 20
      files:
        - "${{dexto.agent_dir}}/README.md"
        - "${{dexto.agent_dir}}/CONTRIBUTING.md"
      options:
        includeFilenames: true
        errorHandling: "skip"

    - id: user-context
      type: memory
      priority: 30
      options:
        pinnedOnly: true
        limit: 10
        includeTags: true
```

## Contributor Types

### Static Contributors
Fixed text content for consistent instructions.

```yaml
- id: guidelines
  type: static
  priority: 1
  content: |
    Always be helpful, respectful, and thorough.
    Provide step-by-step solutions when possible.
```

### Dynamic Contributors
Runtime-generated content:
- **`dateTime`** - Current date and time context
- **`resources`** - MCP server resources (disabled by default)

```yaml
- id: timestamp
  type: dynamic
  priority: 10
  source: dateTime
  enabled: true
```

### File Contributors
Include external documentation files (`.md` and `.txt` only):

```yaml
- id: project-context
  type: file
  priority: 20
  files:
    - "${{dexto.agent_dir}}/docs/guidelines.md"
    - "../README.md"
  options:
    includeFilenames: true
    separator: "\n\n---\n\n"
    maxFileSize: 50000
```

**Path resolution:** Relative paths are resolved from the config file location.

### Memory Contributors
Include user memories from the memory system:

```yaml
- id: user-memories
  type: memory
  priority: 30
  options:
    pinnedOnly: false
    limit: 20
    includeTimestamps: true
    includeTags: true
```

## Priority Ordering

Contributors execute in ascending priority order (1 → 100+). Lower numbers appear first in the final system prompt.

**Recommended ranges:**
- **1-10:** Core behavior and role definition
- **10-50:** Dynamic context (time, resources)
- **50-100:** User memories and custom instructions
- **100+:** Additional context and overrides

## Use Cases

| Scenario | Recommended Approach |
|----------|---------------------|
| Simple chatbot | Single string prompt |
| Development assistant | Static + File contributors for guidelines |
| Customer support | Static + Memory for user preferences |
| Research agent | Static + Dynamic (resources) for live data |
| Personal assistant | All types for maximum context |

## Examples

### Production Agent
```yaml
systemPrompt:
  contributors:
    - id: core
      type: static
      priority: 1
      content: |
        You are a helpful AI assistant designed to work with tools and data.
        Provide clear, accurate responses and use available tools effectively.
    - id: timestamp
      type: dynamic
      priority: 10
      source: dateTime
```

### Customer Support Agent
```yaml
systemPrompt:
  contributors:
    - id: role
      type: static
      priority: 1
      content: |
        You are a customer support assistant.
        Always be polite, professional, and solution-oriented.
    - id: user-context
      type: memory
      priority: 20
      options:
        pinnedOnly: true
        includeTags: true
        limit: 10
```

## Best Practices

1. **Keep it focused** - Clear, specific instructions work better than lengthy prompts
2. **Use priority ordering** - Structure from general (role) to specific (context)
3. **Test behavior** - Validate that prompts produce desired agent responses
4. **File contributors for docs** - Keep large documentation in separate files
5. **Memory for personalization** - Use memory contributors for user-specific context
6. **Enable resources selectively** - MCP resources can be large; only enable when needed

## See Also

- [agent.yml Reference → System Prompt](./agent-yml.md#system-prompt-configuration) - Complete field documentation
- [Memory Configuration](./memory.md) - Configure the memory system
- [MCP Configuration](./mcpConfiguration.md) - Set up resource providers
