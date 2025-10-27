---
sidebar_position: 8
sidebar_label: "Sessions"
---

# Sessions Configuration

Configure session management for your Dexto agent, including maximum concurrent sessions and session timeouts.

:::tip Complete Reference
For complete field documentation and session management details, see **[agent.yml → Sessions](./agent-yml.md#session-configuration)**.
:::

## Overview

Sessions in Dexto represent individual conversation contexts or user interactions. Each session maintains its own message history, tool approvals, and state.

## Configuration

```yaml
sessions:
  maxSessions: 100        # Maximum concurrent sessions
  sessionTTL: 3600000     # Session timeout in milliseconds (1 hour)
```

## Options

### `maxSessions`
- **Type:** Number (positive integer)
- **Default:** 100
- **Description:** Maximum number of concurrent sessions the agent can handle

### `sessionTTL`
- **Type:** Number (milliseconds)
- **Default:** 3600000 (1 hour)
- **Description:** How long sessions remain in memory without activity before being removed from memory (chat history is preserved in storage)

## Examples

### High-Traffic Environment
```yaml
sessions:
  maxSessions: 1000
  sessionTTL: 1800000     # 30 minutes
```

### Low-Resource Environment
```yaml
sessions:
  maxSessions: 20
  sessionTTL: 7200000     # 2 hours
```

### Development Environment
```yaml
sessions:
  maxSessions: 10
  sessionTTL: 86400000    # 24 hours (for debugging)
```

## Session Behavior

- **Automatic cleanup:** Expired sessions are automatically removed from memory (chat history preserved in storage)
- **Session isolation:** Each session has independent conversation history and tool approvals
- **Memory management:** Limiting sessions prevents memory exhaustion in long-running deployments
- **Chat persistence:** Conversation history is always preserved in storage and can be restored when sessions are accessed again

## Default Configuration

If not specified, Dexto uses:
```yaml
sessions:
  maxSessions: 100
  sessionTTL: 3600000
```

This provides a good balance for most use cases.

## See Also

- [agent.yml Reference → Sessions](./agent-yml.md#session-configuration) - Complete field documentation
- [Storage Configuration](./storage.md) - Persistent chat history storage