---
sidebar_position: 6
sidebar_label: "Permissions"
---

# Permissions Configuration

Control how and when users are prompted to approve tool execution through Dexto's flexible confirmation system.

:::tip Complete Reference
For complete field documentation, event specifications, and UI integration details, see **[agent.yml → Permissions](./agent-yml.md#permissions)**.
:::

## Overview

The permissions system provides security and oversight by controlling which tools your agent can execute and when. It supports multiple modes and fine-grained policies for different environments and use cases.

**Configuration controls:**
- **Confirmation mode** - How tools are approved (interactive, auto-approve, auto-deny)
- **Timeout duration** - How long to wait for user response
- **Storage type** - Where to remember approvals (persistent vs session-only)
- **Tool policies** - Fine-grained allow/deny lists

:::note Elicitation vs Permissions
**Permissions** control whether tools require approval before execution. **Elicitation** is a separate feature that controls whether MCP servers can request user input during interactions. These are independent settings - see [Elicitation Configuration](./agent-yml.md#elicitation-configuration) for details.
:::

## Confirmation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **manual** | Interactive prompts via CLI/WebUI | Production with oversight |
| **auto-approve** | Automatically approve all tools | Development/testing |
| **auto-deny** | Block all tool execution | Read-only/high-security |

### manual (Default)

Interactive confirmation via CLI prompts or WebUI dialogs:

```yaml
permissions:
  mode: manual
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
permissions:
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
permissions:
  mode: auto-deny
```

**When to use:**
- High-security environments
- Read-only deployments
- Completely disable tool execution

## Tool Policies

Fine-grained control over specific tools:

```yaml
permissions:
  mode: manual
  toolPolicies:
    alwaysAllow:
      - ask_user
      - read_file
      - mcp--filesystem--read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
      - mcp--git--push
```

**Tool name format:**
- Local tools: `<tool_id>`
- MCP tools: `mcp--<server_name>--<tool_name>`
  - You can also use `mcp--<tool_name>` as a shorthand to match any MCP server that exposes that tool.

**Precedence rules:**
1. `alwaysDeny` takes precedence over `alwaysAllow`
2. Tool policies override confirmation mode
3. Empty arrays by default

## Storage Options

### storage (Default)
Approvals persisted across sessions:

```yaml
permissions:
  allowedToolsStorage: storage
```

**Pros:** Convenient - approve once, use forever

**Cons:** Less secure - approvals persist until cleared

### memory
Approvals cleared when session ends:

```yaml
permissions:
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
permissions:
  mode: auto-approve
  allowedToolsStorage: memory
  toolPolicies:
    alwaysDeny:
      - bash_exec
```

### Production Environment

```yaml
permissions:
  mode: manual
  timeout: 60000
  allowedToolsStorage: storage
  toolPolicies:
    alwaysAllow:
      - ask_user
      - read_file
    alwaysDeny:
      - mcp--filesystem--delete_file
      - mcp--git--push
```

### High-Security Environment

```yaml
permissions:
  mode: manual
  allowedToolsStorage: memory
  toolPolicies:
    alwaysAllow: []
    alwaysDeny:
      - mcp--filesystem--write_file
      - mcp--filesystem--delete_file
      - bash_exec
```

## Manual Mode Requirements

Manual mode requires UI integration to prompt the user for approvals:

- **CLI Mode**: Interactive prompts in the terminal
- **Web/Server Mode**: Approval dialogs in the WebUI
- **Custom Integration**: Implement your own approval handler via `agent.setApprovalHandler()`

The system will wait for user input up to the configured timeout, then auto-deny if no response is received.

## Approval Handlers

Approval handlers control how your application prompts for and receives user decisions about tool execution.

### Built-in Options

**Auto modes**: No handler needed - `auto-approve` and `auto-deny` modes handle approvals automatically without requiring a handler implementation.

**Manual handler for server/API mode**: Use `createManualApprovalHandler` from `@dexto/server` when building web applications. This handler coordinates approvals between backend and frontend via event bus:

```typescript
import { ApprovalCoordinator, createManualApprovalHandler } from '@dexto/server';

const coordinator = new ApprovalCoordinator();
const handler = createManualApprovalHandler(coordinator);
agent.setApprovalHandler(handler);
```

### Custom Handlers

For CLI tools, desktop apps, or custom integrations, implement your own handler:

```typescript
import { ApprovalStatus, DenialReason } from '@dexto/core';

agent.setApprovalHandler(async (request) => {
  // request contains: approvalId, type, metadata (toolName, args, etc.)

  const userChoice = await promptUser(
    `Allow ${request.metadata.toolName}?`
  );

  return {
    approvalId: request.approvalId,
    status: userChoice ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED,
    reason: userChoice ? undefined : DenialReason.USER_DENIED,
  };
});
```

**Common use cases for custom handlers:**
- CLI tools (readline, inquirer, prompts)
- Desktop apps (native dialogs, Electron)
- Policy-based approval (check against rules)
- External integrations (Slack, PagerDuty)
- Audit logging wrappers

## Best Practices

1. **Use manual mode in production** - Maintain oversight and control
2. **Set reasonable timeouts** - Balance security with user experience
3. **Enable read-only tools** - Allow safe operations without confirmation
4. **Block destructive operations** - Use `alwaysDeny` for dangerous tools
5. **Use memory storage for sensitive environments** - Don't persist approvals
6. **Test policies** - Verify tool policies work as expected

## Common Use Cases

| Scenario | Configuration |
|----------|--------------|
| **Development** | auto-approve + memory storage |
| **Production** | manual + storage + policies |
| **CI/CD** | auto-deny (no tool execution) |
| **Read-only** | manual + alwaysAllow read operations |
| **High-security** | manual + memory storage + strict deny list |

## See Also

- [agent.yml Reference → Permissions](./agent-yml.md#permissions) - Complete field documentation
- [Tools](./tools.md) - Tool factory configuration
- [MCP Configuration](./mcpConfiguration.md) - External MCP tools
- [Storage Configuration](./storage.md) - Persistent approval storage
