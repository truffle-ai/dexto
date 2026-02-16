---
sidebar_position: 11
---

# Internal Tools

Configure built-in Dexto capabilities that provide core agent functionality like file operations, code search, and command execution.

:::tip Complete Reference
For complete tool specifications, parameters, and usage details, see **[agent.yml → Internal Tools](./agent-yml.md#internal-tools)**.
:::

## Overview

Internal tools are built directly into Dexto core, providing essential capabilities for agents to interact with the local filesystem, execute commands, and collect user input.

**Key characteristics:**
- Built into Dexto (no external dependencies)
- Can be enabled/disabled per agent
- Subject to tool confirmation policies
- Optimized for common agent workflows

## Available Tools

| Tool | Purpose | Safety |
|------|---------|--------|
| **ask_user** | Collect structured user input | Safe |
| **read_file** | Read file contents | Read-only |
| **write_file** | Create/overwrite files | Requires approval |
| **edit_file** | Precise file edits | Requires approval |
| **glob_files** | Find files by pattern | Read-only |
| **grep_content** | Search code with regex | Read-only |
| **bash_exec** | Execute shell commands | Dangerous |
| **bash_output** | Monitor background processes | Safe |
| **kill_process** | Terminate processes | Safe |

## Configuration

Enable tools by listing them:

```yaml
internalTools:
  - ask_user
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
```

**Disable all tools:**
```yaml
internalTools: []
```

## Tool Categories

### File Reading (Read-only)

**read_file** - Read file contents with pagination:
```yaml
internalTools:
  - read_file
```

**glob_files** - Find files by pattern:
```yaml
internalTools:
  - glob_files
```
Common patterns: `**/*.ts`, `**/config.{yml,yaml,json}`

**grep_content** - Search code with regex:
```yaml
internalTools:
  - grep_content
```
Example: Find function definitions, imports, class usage

### File Writing (Requires Approval)

**write_file** - Create/overwrite files:
```yaml
internalTools:
  - write_file
```

**edit_file** - Make precise changes:
```yaml
internalTools:
  - read_file  # Often used together
  - edit_file
```

### Command Execution (Dangerous)

**bash_exec** - Execute shell commands:
```yaml
internalTools:
  - bash_exec
```

**bash_output** - Monitor background processes:
```yaml
internalTools:
  - bash_exec
  - bash_output
```

**kill_process** - Terminate processes:
```yaml
internalTools:
  - bash_exec
  - bash_output
  - kill_process
```

### User Interaction (Safe)

**ask_user** - Collect structured input:
```yaml
internalTools:
  - ask_user
```

## Common Tool Combinations

### Read-Only Analysis Agent

```yaml
internalTools:
  - read_file
  - glob_files
  - grep_content
  - ask_user

permissions:
  mode: auto-approve  # Safe since all read-only
```

### Coding Agent

```yaml
internalTools:
  - read_file
  - write_file
  - edit_file
  - glob_files
  - grep_content
  - bash_exec
  - ask_user

permissions:
  mode: manual
  toolPolicies:
    alwaysAllow:
      - internal--read_file
      - internal--glob_files
      - internal--grep_content
      - internal--ask_user
```

### DevOps Agent

```yaml
internalTools:
  - read_file
  - write_file
  - bash_exec
  - bash_output
  - kill_process

permissions:
  mode: manual
  toolPolicies:
    alwaysAllow:
      - internal--read_file
      - internal--bash_output
      - internal--kill_process
    alwaysDeny:
      - internal--bash_exec--rm -rf*
```

## Permissions Policies

Configure which tools require approval:

```yaml
permissions:
  mode: manual
  toolPolicies:
    # Safe, read-only operations
    alwaysAllow:
      - internal--read_file
      - internal--glob_files
      - internal--grep_content
      - internal--ask_user

    # Explicitly deny dangerous operations
    alwaysDeny:
      - internal--bash_exec--rm -rf*
      - internal--bash_exec--sudo*
```

## Best Practices

1. **Enable only what you need** - Don't enable all tools unnecessarily
2. **Pair tools with instructions** - Guide agents in system prompt
3. **Use safe defaults** - Auto-approve read-only, require confirmation for writes
4. **Provide usage examples** - Include patterns in system prompt

**Example system prompt:**
```yaml
systemPrompt: |
  ## Tool Usage Guidelines

  Finding Files:
  - Use glob_files with "**/*.ts" for TypeScript files
  - Use grep_content to search for patterns

  Editing Files:
  - ALWAYS read_file first to see current content
  - Use edit_file with unique old_string for precision

  Running Commands:
  - Use bash_exec for tests: "npm test"
  - Never use destructive commands without approval
```

## Use Cases

| Agent Type | Recommended Tools |
|-----------|------------------|
| **Code Analyst** | read_file, glob_files, grep_content, ask_user |
| **Developer** | read_file, write_file, edit_file, glob_files, grep_content, bash_exec |
| **DevOps** | read_file, write_file, bash_exec, bash_output, kill_process |
| **Documentation** | read_file, write_file, glob_files |

## See Also

- [agent.yml Reference → Internal Tools](./agent-yml.md#internal-tools) - Complete tool documentation
- [Permissions](./permissions.md) - Configure approval policies
- [System Prompt](./systemPrompt.md) - Guide agents on tool usage
