---
sidebar_position: 5
---

# MCP Configuration

Configure Model Context Protocol (MCP) servers to extend your agent's capabilities by connecting to external tools, services, and APIs.

:::tip Complete Reference
For complete field documentation, transport specifications, and troubleshooting, see **[agent.yml → MCP Servers](./agent-yml.md#mcp-servers)**.
:::

## Overview

MCP servers provide tools and resources that your agents can discover and use at runtime. Unlike internal tools which are built into Dexto, MCP servers are external processes or services that communicate using the standardized Model Context Protocol.

**Key characteristics:**
- Pluggable architecture - Add/remove servers dynamically
- Multiple transport types - stdio, HTTP, and SSE
- Environment variable support - Secure configuration
- Connection modes - Strict vs lenient error handling
- Tool aggregation - Multiple servers' tools available simultaneously

## Server Types

| Transport | Use Case | Protocol |
|-----------|----------|----------|
| **stdio** | Local processes, file operations, system tools | stdin/stdout |
| **http** | Remote APIs, cloud services (recommended) | HTTP/REST |
| **sse** | Legacy streaming integrations (deprecated) | Server-Sent Events |

## Quick Examples

### Example 1 - Local Filesystem Access

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    timeout: 30000
    connectionMode: lenient
```

### Example 2 - Remote HTTP Service

```yaml
mcpServers:
  api-service:
    type: http
    url: https://api.example.com/mcp
    headers:
      Authorization: Bearer $API_TOKEN
    timeout: 45000
    connectionMode: strict
```

### Example 3 - Multiple Servers

```yaml
mcpServers:
  # Local filesystem
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    connectionMode: strict

  # Browser automation
  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
    connectionMode: lenient

  # Remote service
  analytics:
    type: http
    url: $ANALYTICS_URL
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
    connectionMode: lenient
```

## Transport Types

### stdio - Local Process Servers

Execute local programs that communicate via stdin/stdout.

**Use when:**
- Running local tools (filesystem, git, database)
- Development and testing
- System command execution
- Fast, no-network operations

**Configuration:**
```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    env:
      DATABASE_URL: $DATABASE_URL
    timeout: 30000
    connectionMode: lenient
```

**Common stdio servers:**
- `@modelcontextprotocol/server-filesystem` - File operations
- `@playwright/mcp` - Browser automation
- `@modelcontextprotocol/server-github` - GitHub integration

### http - HTTP Servers (Recommended)

Connect to standard HTTP/REST servers.

**Use when:**
- Integrating cloud services
- Production deployments
- Third-party APIs
- Reliable remote communication

**Configuration:**
```yaml
mcpServers:
  external-api:
    type: http
    url: https://api.external-service.com/mcp
    headers:
      Authorization: Bearer $EXTERNAL_API_TOKEN
      X-Client-Version: "1.0"
    timeout: 45000
    connectionMode: strict
```

### sse - Server-Sent Events (Deprecated)

Legacy streaming integration. Consider HTTP for new projects.

## Connection Modes

### lenient (Default)

**Behavior:**
- Logs warning if server fails to connect
- Continues agent initialization
- Agent remains functional without this server

**Use when:**
- Server provides optional enhancements
- Development/testing environments
- Server may be temporarily unavailable

```yaml
mcpServers:
  optional-analytics:
    type: http
    url: https://analytics.example.com/mcp
    connectionMode: lenient
```

### strict

**Behavior:**
- Throws error if server fails to connect
- Stops agent initialization
- Ensures server availability before agent starts

**Use when:**
- Server is critical for agent functionality
- Production environments requiring reliability
- Data consistency is important

```yaml
mcpServers:
  critical-database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    connectionMode: strict
```

### Global --strict Flag

Override all connection modes:

```bash
dexto --strict  # Makes ALL servers strict
```

## Environment Variables

All MCP configurations support environment variable expansion using `$VAR` syntax.

**Supported fields:**
- `command` - stdio command executable
- `args` - Each argument in the array
- `url` - Server endpoint URLs
- `headers` - Header values
- `env` - Environment variable values

**Example:**
```yaml
mcpServers:
  secure-service:
    type: http
    url: $SERVICE_URL
    headers:
      Authorization: Bearer $API_KEY
```

**Security best practice:** Always use environment variables for secrets, never hardcode them.

## Common Use Cases

### Development vs Production

**Development:**
```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    timeout: 10000
    connectionMode: lenient
```

**Production:**
```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server@2.1.0"]  # Pinned version
    timeout: 60000
    connectionMode: strict
```

### Content Creation Agent

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    connectionMode: strict

  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
    connectionMode: lenient
```

### Data Analysis Agent

```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    env:
      DATABASE_URL: $DATABASE_URL
    connectionMode: strict

  analytics-api:
    type: http
    url: $ANALYTICS_API_URL
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
    connectionMode: strict
```

## Tool Aggregation

When multiple MCP servers are configured, Dexto aggregates all their tools. Tools are prefixed with server names to avoid conflicts:

**Format:** `<server-name>__<tool-name>`

**Example:**
```yaml
mcpServers:
  filesystem:
    # Provides: filesystem__read_file, filesystem__write_file
  playwright:
    # Provides: playwright__navigate, playwright__screenshot
```

Agent sees: `filesystem__read_file`, `filesystem__write_file`, `playwright__navigate`, `playwright__screenshot`

## Best Practices

1. **Use appropriate connection modes** - Strict for critical, lenient for optional
2. **Set reasonable timeouts** - Shorter for local (10s), longer for remote (60s)
3. **Pin versions in production** - `@package@version` for stability
4. **Use environment variables** - Never hardcode secrets
5. **Document server purposes** - Add comments explaining each server's role
6. **Group related servers** - Organize config sections logically
7. **Test connections** - Verify servers work before deploying

## See Also

- [agent.yml Reference → MCP Servers](./agent-yml.md#mcp-servers) - Complete field documentation
- [Permissions](./permissions.md) - Control MCP tool execution
- [MCP Overview](../../mcp/overview.md) - What is MCP and why it matters
- [MCP Manager](../../mcp/mcp-manager.md) - Runtime server management
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers) - Available MCP servers
