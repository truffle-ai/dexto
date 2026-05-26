---
sidebar_position: 6
sidebar_label: "Permissions"
---

# Permissions Configuration

Control how and when users are prompted to approve tool execution through Dexto's approval system.

:::tip Complete Reference
For complete field documentation, event specifications, and UI integration details, see **[agent.yml → Permissions](./agent-yml.md#permissions)**.
:::

## Overview

The permissions system controls whether tools require user approval before execution.

**Configuration controls:**
- **Approval mode** - How tools are approved (`manual` or `auto-approve`)
- **Timeout duration** - How long manual mode waits for a user response
- **Storage type** - Where remembered approvals are stored
- **Tool policies** - Fine-grained allow lists for low-risk tools

:::note Elicitation vs Permissions
**Permissions** control whether tools require approval before execution. **Elicitation** is a separate feature that controls whether MCP servers can request user input during interactions. These are independent settings - see [Elicitation Configuration](./agent-yml.md#elicitation-configuration) for details.
:::

## Approval Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **manual** | Interactive prompts via CLI/WebUI | Production with oversight |
| **auto-approve** | Automatically approve all tools | Development/testing |

### manual (Default)

Interactive approval via CLI prompts or WebUI dialogs:

```yaml
permissions:
  mode: manual
  timeout: 30000               # 30 seconds
  allowedToolsStorage: storage # Persist remembered approvals
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

## Tool Policies

Fine-grained control over specific low-risk tools:

```yaml
permissions:
  mode: manual
  toolPolicies:
    alwaysAllow:
      - ask_user
      - read_file
      - mcp--filesystem--read_file
```

**Tool name format:**
- Local tools: `<tool_id>`
- MCP tools: `mcp--<server_name>--<tool_name>`
  - You can also use `mcp--<tool_name>` as a shorthand to match any MCP server that exposes that tool.

**Resolution order:**
1. Session-specific remembered approvals
2. Static `alwaysAllow` policies
3. Dynamic allowed-tools provider
4. Manual approval or auto-approve mode

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

The system checks session-specific approvals before global approvals.

## Configuration Examples

### Development Environment

```yaml
permissions:
  mode: auto-approve
  allowedToolsStorage: memory
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
```

### Sensitive Environment

```yaml
permissions:
  mode: manual
  allowedToolsStorage: memory
  toolPolicies:
    alwaysAllow: []
```

## Manual Mode Requirements

Manual mode requires UI integration to prompt the user for approvals:

- **CLI Mode**: Interactive prompts in the terminal
- **Web/Server Mode**: Approval dialogs in the WebUI
- **Custom Integration**: Implement your own approval handler via `agent.setApprovalHandler()`

The system will wait for user input up to the configured timeout. If no timeout is configured, the approval waits until a response is submitted or the host cancels the request.

## Approval Handlers

Approval handlers control how your application prompts for and receives user decisions about tool execution.

### Built-in Options

**Auto-approve mode**: No handler needed for tool approvals.

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
3. **Allow read-only tools** - Let safe operations run without repeated confirmation
4. **Use memory storage for sensitive environments** - Don't persist approvals
5. **Test policies** - Verify allow policies work as expected

## Common Use Cases

| Scenario | Configuration |
|----------|--------------|
| **Development** | auto-approve + memory storage |
| **Production** | manual + storage + allow policies |
| **CI/CD** | auto-approve only when the environment is trusted |
| **Read-only** | manual + alwaysAllow read operations |
| **Sensitive** | manual + memory storage |

## See Also

- [agent.yml Reference → Permissions](./agent-yml.md#permissions) - Complete field documentation
- [Tools](./tools.md) - Tool factory configuration
- [MCP Configuration](./mcpConfiguration.md) - External MCP tools
- [Storage Configuration](./storage.md) - Persistent approval storage
