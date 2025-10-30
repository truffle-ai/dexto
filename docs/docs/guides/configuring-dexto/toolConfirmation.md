---
sidebar_position: 6
sidebar_label: "Tool Confirmation"
---

# Tool Confirmation Configuration

Control how and when users are prompted to approve tool execution through Dexto's flexible confirmation system.

:::tip Complete Reference
For complete field documentation, event specifications, and UI integration details, see **[agent.yml → Tool Confirmation](./agent-yml.md#tool-confirmation)**.
:::

## Overview

The tool confirmation system provides security and oversight by controlling which tools your agent can execute and when. It supports multiple modes and fine-grained policies for different environments and use cases.

**Configuration controls:**
- **Confirmation mode** - How tools are approved (interactive, auto-approve, auto-deny)
- **Timeout duration** - How long to wait for user response
- **Storage type** - Where to remember approvals (persistent vs session-only)
- **Tool policies** - Fine-grained allow/deny lists

## Confirmation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **event-based** | Interactive prompts via CLI/WebUI | Production with oversight |
| **auto-approve** | Automatically approve all tools | Development/testing |
| **auto-deny** | Block all tool execution | Read-only/high-security |

### event-based (Default)

Interactive confirmation via CLI prompts or WebUI dialogs:

```yaml
toolConfirmation:
  mode: event-based
  timeout: 30000               # 30 seconds
  allowedToolsStorage: storage # Persist across sessions
```

**When to use:**
- Production environments needing oversight
- Multi-user environments with different permissions
- Development with tool approval tracking

### auto-approve

Automatically approve all tools without prompting:

```yaml
toolConfirmation:
  mode: auto-approve
```

**When to use:**
- Development where speed is important
- Trusted automation scripts
- Testing scenarios

CLI shortcut: `dexto --auto-approve`

### auto-deny

Block all tool execution:

```yaml
toolConfirmation:
  mode: auto-deny
```

**When to use:**
- High-security environments
- Read-only deployments
- Completely disable tool execution

## Tool Policies

Fine-grained control over specific tools:

```yaml
toolConfirmation:
  mode: event-based
  toolPolicies:
    alwaysAllow:
      - internal--ask_user
      - internal--read_file
      - mcp--filesystem--read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
      - mcp--git--push
```

**Tool name format:**
- Internal tools: `internal--<tool_name>`
- MCP tools: `mcp--<server_name>--<tool_name>`

**Precedence rules:**
1. `alwaysDeny` takes precedence over `alwaysAllow`
2. Tool policies override confirmation mode
3. Empty arrays by default

## Storage Options

### storage (Default)
Approvals persisted across sessions:

```yaml
toolConfirmation:
  allowedToolsStorage: storage
```

**Pros:** Convenient - approve once, use forever

**Cons:** Less secure - approvals persist until cleared

### memory
Approvals cleared when session ends:

```yaml
toolConfirmation:
  allowedToolsStorage: memory
```

**Pros:** More secure - no persistent approvals

**Cons:** Need to re-approve in each session

## Session-Aware Approvals

Approvals can be scoped to specific sessions or applied globally:

**Session-scoped:** Only applies to one conversation

**Global:** Applies to all sessions

The system checks: session-specific → global → deny

## Configuration Examples

### Development Environment

```yaml
toolConfirmation:
  mode: auto-approve
  allowedToolsStorage: memory
  toolPolicies:
    alwaysDeny:
      - internal--bash_exec--rm -rf*
```

### Production Environment

```yaml
toolConfirmation:
  mode: event-based
  timeout: 60000
  allowedToolsStorage: storage
  toolPolicies:
    alwaysAllow:
      - internal--ask_user
      - internal--read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
      - mcp--git--push
```

### High-Security Environment

```yaml
toolConfirmation:
  mode: event-based
  allowedToolsStorage: memory
  toolPolicies:
    alwaysAllow: []
    alwaysDeny:
      - mcp--filesystem--write_file
      - mcp--filesystem--delete_file
      - internal--bash_exec
```

## Event-Based Flow

In event-based mode, confirmation uses an event-driven architecture:

1. Agent requests tool execution
2. System emits `dexto:toolConfirmationRequest` event
3. UI layer shows confirmation dialog
4. User approves/denies
5. UI emits `dexto:toolConfirmationResponse` event
6. Tool executes or is denied

**Timeout:** Auto-denies if no response within configured timeout.

## Best Practices

1. **Use event-based in production** - Maintain oversight and control
2. **Set reasonable timeouts** - Balance security with user experience
3. **Enable read-only tools** - Allow safe operations without confirmation
4. **Block destructive operations** - Use `alwaysDeny` for dangerous tools
5. **Use memory storage for sensitive environments** - Don't persist approvals
6. **Test policies** - Verify tool policies work as expected

## Common Use Cases

| Scenario | Configuration |
|----------|--------------|
| **Development** | auto-approve + memory storage |
| **Production** | event-based + storage + policies |
| **CI/CD** | auto-deny (no tool execution) |
| **Read-only** | event-based + alwaysAllow read operations |
| **High-security** | event-based + memory storage + strict deny list |

## See Also

- [agent.yml Reference → Tool Confirmation](./agent-yml.md#tool-confirmation) - Complete field documentation
- [Internal Tools](./internalTools.md) - Built-in Dexto tools
- [MCP Configuration](./mcpConfiguration.md) - External MCP tools
- [Storage Configuration](./storage.md) - Persistent approval storage
