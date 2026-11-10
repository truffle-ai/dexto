---
sidebar_position: 6
sidebar_label: 'Permissions'
---

# Permissions Configuration

Control how and when users are prompted to approve tool execution through Dexto's approval system.

:::tip Complete Reference
For complete field documentation, event specifications, and UI integration details, see **[agent.yml → Permissions](./agent-yml.md#permissions)**.
:::

## Overview

The permissions system controls whether tools require user approval before execution.

**Configuration controls:**

- **Permissions mode** - **Full access** (`full-access`) or **Asks you** (`asks-you`), the same two choices as the hosted app
- **Timeout duration** - How long Asks you waits for a user response
- **Storage type** - Where remembered approvals are stored
- **Tool policies** - Fine-grained allow lists for low-risk tools

:::note Elicitation vs Permissions
**Permissions** control whether tools require approval before execution. **Elicitation** is a separate feature that controls whether MCP servers can request user input during interactions. These are independent settings - see [Elicitation Configuration](./agent-yml.md#elicitation-configuration) for details.
:::

## Permission Modes

| Mode                            | Behavior                                                                  | Use Case                  |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| **Asks you** (`asks-you`)       | Asks before file edits, shell commands and other approval-sensitive tools | Oversight of every change |
| **Full access** (`full-access`) | Runs tools without asking (default)                                       | Trusted tasks, automation |

:::note Deprecated values
`manual` and `auto-approve` still work for one release. `manual` maps to `asks-you` and `auto-approve` maps to `full-access`, and Dexto prints a warning naming the new value. Update your agent files and `--permissions-mode` flags before the next release.
:::

### Asks you

Dexto asks before it changes anything: file writes and edits (including files inside your workspace), shell commands, and tools from MCP servers. Reading files inside the workspace does not ask. Approval prompts appear in the CLI or as WebUI dialogs:

```yaml
permissions:
    mode: asks-you
    timeout: 30000 # 30 seconds
    allowedToolsStorage: storage # Persist remembered approvals
```

**When to use:**

- Production environments needing oversight
- Multi-user environments with different permissions
- Development with tool approval tracking

### Full access (Default)

Runs tools without asking. Tools that always require a fresh approval still ask:

```yaml
permissions:
    mode: full-access
```

**When to use:**

- Development where speed is important
- Trusted automation scripts
- Testing scenarios

CLI: `dexto --permissions-mode full-access` (or the `--auto-approve` / `--bypass-permissions` aliases)

## Session permissions in the TUI

Use `/permissions` in a local terminal chat to choose an approval mode and inspect or revoke remembered permissions:

- **Agent defaults** follows your agent configuration and remembered grants.
- **Accept edits for this session** approves file edits automatically.
- **Full access for this session** approves tool and command requests automatically, while preserving disabled tools and requests that always require approval.

These TUI modes reset when switching conversations. They do not change your agent YAML or global preferences.

When a tool asks for approval, choose **Allow once**, **Allow the displayed scope for this session**, or **Reject**. The remembered scope may be a whole tool, a command pattern such as `git status *`, or an exact action. Remembered grants belong to the conversation and remain when you resume it; select a grant in `/permissions` to revoke it. Revocation removes that remembered grant; separately configured permissions still apply.

Compound shell commands and commands with shell expansions use exact command scopes rather than sharing a simple command pattern. Full access remains available for trusted tasks without repeated prompts. Tool permissions do not provide OS-level sandbox isolation.

`/permissions` is available only for chat backends that support inspecting and revoking session grants. This change preserves existing default approval configuration and headless `dexto run` behavior.

## Tool Policies

Fine-grained control over specific low-risk tools:

```yaml
permissions:
    mode: asks-you
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
4. The permissions mode (Asks you prompts; Full access runs)

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
    mode: full-access
    allowedToolsStorage: memory
```

### Production Environment

```yaml
permissions:
    mode: asks-you
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
    mode: asks-you
    allowedToolsStorage: memory
    toolPolicies:
        alwaysAllow: []
```

## Asks you Requirements

Asks you requires UI integration to prompt the user for approvals:

- **CLI Mode**: Interactive prompts in the terminal
- **Web/Server Mode**: Approval dialogs in the WebUI
- **Custom Integration**: Implement your own approval handler via `agent.setApprovalHandler()`

The system will wait for user input up to the configured timeout. If no timeout is configured, the approval waits until a response is submitted or the host cancels the request.

## Approval Handlers

Approval handlers control how your application prompts for and receives user decisions about tool execution.

### Built-in Options

**Full access**: No handler needed for tool approvals.

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

    const userChoice = await promptUser(`Allow ${request.metadata.toolName}?`);

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

1. **Use Asks you when you want oversight** - Review every change before it happens
2. **Set reasonable timeouts** - Balance security with user experience
3. **Allow read-only tools** - Let safe operations run without repeated confirmation
4. **Use memory storage for sensitive environments** - Don't persist approvals
5. **Test policies** - Verify allow policies work as expected

## Common Use Cases

| Scenario        | Configuration                                    |
| --------------- | ------------------------------------------------ |
| **Development** | Full access + memory storage                     |
| **Production**  | Asks you + storage + allow policies              |
| **CI/CD**       | Full access only when the environment is trusted |
| **Read-only**   | Asks you + alwaysAllow read operations           |
| **Sensitive**   | Asks you + memory storage                        |

## See Also

- [agent.yml Reference → Permissions](./agent-yml.md#permissions) - Complete field documentation
- [Tools](./tools.md) - Tool factory configuration
- [MCP Configuration](./mcpConfiguration.md) - External MCP tools
- [Storage Configuration](./storage.md) - Persistent approval storage
