---
sidebar_position: 9
---

# MCP Configuration

Configure Model Context Protocol (MCP) servers to extend your agent's capabilities by connecting to external tools, services, and APIs. Dexto supports multiple transport types and connection modes for flexible integration with both local and remote MCP servers.

## Overview

MCP servers provide tools and resources that your agents can discover and use at runtime. Unlike internal tools which are built into Dexto, MCP servers are external processes or services that communicate using the standardized Model Context Protocol.

**Key characteristics:**
- Pluggable architecture - Add/remove servers dynamically
- Multiple transport types - stdio, HTTP, and SSE
- Environment variable support - Secure configuration with `$ENV_VAR` syntax
- Connection modes - Strict vs lenient error handling
- Tool aggregation - Multiple servers' tools available simultaneously

## Configuration

Configure MCP servers in the `mcpServers` section of your agent configuration:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "."
    timeout: 30000
    connectionMode: lenient
```

**Disabling all MCP servers:**
```yaml
mcpServers: {}
```

**Omitting the field** also disables all MCP servers.

## Server Types

### stdio - Local Process Servers

Execute local programs that communicate via stdin/stdout. Best for local tools, development, and file operations.

**Capabilities:**
- Launch local processes with full control
- Pass environment variables securely
- Fast communication with no network overhead
- Access to local filesystem and system resources

**Use cases:**
- Filesystem operations (read/write/list files)
- Browser automation (Playwright)
- Local database access
- System command execution
- Git operations

**Configuration:**

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "."
    env:
      DEBUG: "mcp:*"
      ROOT: ./workspace
    timeout: 30000
    connectionMode: lenient
```

**Parameters:**
- `type` (required) - Must be `stdio`
- `command` (required) - Executable command (e.g., `npx`, `node`, `python`)
  - Supports environment variable expansion: `$MY_COMMAND`
- `args` (optional) - Array of command arguments
  - Default: `[]`
  - Supports environment variable expansion in each argument
- `env` (optional) - Environment variables for the process
  - Default: `{}`
  - Merged with system environment
- `timeout` (optional) - Connection timeout in milliseconds
  - Default: `30000` (30 seconds)
- `connectionMode` (optional) - Error handling mode
  - Default: `lenient`
  - Options: `strict` | `lenient`

**Common stdio servers:**

```yaml
mcpServers:
  # Filesystem access
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

  # Web browser automation
  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]

  # Database operations
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    env:
      DATABASE_URL: $DATABASE_URL

  # GitHub integration
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: $GITHUB_TOKEN
```

**Best practices:**
- Use `npx -y` to auto-install packages
- Set specific package versions for production: `"package@1.0.0"`
- Pass sensitive data via environment variables, not args
- Use absolute paths when specifying directories

---

### sse - Server-Sent Events

Connect to remote servers using Server-Sent Events over HTTP. Useful for real-time streaming data and cloud-hosted tools.

:::note Deprecation Notice
SSE transport is on the deprecation path. Consider using [HTTP transport](#http---http-servers) for new integrations.
:::

**Capabilities:**
- Real-time event streaming
- Long-lived connections
- Cloud-hosted tool access
- Firewall-friendly (HTTP-based)

**Use cases:**
- Real-time data feeds
- Cloud analytics services
- Remote monitoring tools
- Streaming API integrations

**Configuration:**

```yaml
mcpServers:
  remote-analytics:
    type: sse
    url: https://analytics.example.com/mcp/events
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
      X-Custom-Header: value
    timeout: 60000
    connectionMode: lenient
```

**Parameters:**
- `type` (required) - Must be `sse`
- `url` (required) - SSE endpoint URL
  - Supports environment variable expansion: `$API_URL`
- `headers` (optional) - HTTP headers for authentication/configuration
  - Default: `{}`
  - Supports environment variable expansion in values
- `timeout` (optional) - Connection timeout in milliseconds
  - Default: `30000` (30 seconds)
  - Consider longer timeouts for slow networks
- `connectionMode` (optional) - Error handling mode
  - Default: `lenient`
  - Options: `strict` | `lenient`

**Example with authentication:**

```yaml
mcpServers:
  remote-service:
    type: sse
    url: $SSE_SERVER_URL
    headers:
      Authorization: Bearer $SSE_API_TOKEN
      User-Agent: Dexto/1.0
      X-Client-ID: $CLIENT_ID
    timeout: 90000  # 90 seconds for slow networks
    connectionMode: lenient
```

**Best practices:**
- Use HTTPS URLs for security
- Set longer timeouts for unstable connections
- Include User-Agent header for server logging
- Use lenient mode for optional cloud services

---

### http - HTTP Servers

Connect to standard HTTP/REST servers with streamable transport. Recommended for all new remote MCP integrations.

**Capabilities:**
- Reliable HTTP-based communication
- Wide server compatibility
- Request/response patterns
- Standard HTTP features (retries, caching, etc.)

**Use cases:**
- RESTful API integrations
- Cloud service connections
- Enterprise tool integrations
- Third-party service APIs

**Configuration:**

```yaml
mcpServers:
  api-service:
    type: http
    url: https://api.example.com/mcp
    headers:
      Authorization: Bearer $API_TOKEN
      Content-Type: application/json
    timeout: 45000
    connectionMode: strict
```

**Parameters:**
- `type` (required) - Must be `http`
- `url` (required) - HTTP server base URL
  - Supports environment variable expansion: `$API_BASE_URL`
- `headers` (optional) - HTTP headers for all requests
  - Default: `{}`
  - Supports environment variable expansion in values
- `timeout` (optional) - Request timeout in milliseconds
  - Default: `30000` (30 seconds)
- `connectionMode` (optional) - Error handling mode
  - Default: `lenient`
  - Options: `strict` | `lenient`

**Example with multiple services:**

```yaml
mcpServers:
  # External API with authentication
  external-api:
    type: http
    url: https://api.external-service.com/mcp
    headers:
      Authorization: Bearer $EXTERNAL_API_TOKEN
      X-Client-Version: "1.0"
    timeout: 45000
    connectionMode: strict

  # Internal microservice
  internal-service:
    type: http
    url: http://internal-mcp.company.local:8080
    headers:
      X-Internal-Auth: $INTERNAL_TOKEN
    timeout: 30000
    connectionMode: lenient
```

**Best practices:**
- Use HTTPS for external services
- Set appropriate timeouts based on expected response times
- Include API version in headers for versioned APIs
- Use strict mode for critical dependencies

---

## Connection Modes

The `connectionMode` field controls how Dexto handles server connection failures:

### lenient (Default)

**Behavior:**
- Logs warning if server fails to connect
- Continues agent initialization
- Server can be retried later
- Agent remains functional without this server

**Use when:**
- Server provides optional enhancements
- Agent can function without this server
- Server may be temporarily unavailable
- Development/testing environments

**Example:**

```yaml
mcpServers:
  optional-analytics:
    type: http
    url: https://analytics.example.com/mcp
    connectionMode: lenient  # Agent works without analytics
```

---

### strict

**Behavior:**
- Throws error if server fails to connect
- Stops agent initialization
- Ensures server is available before agent starts
- Immediate failure feedback

**Use when:**
- Server is critical for agent functionality
- Agent cannot work without this server
- Production environments requiring reliability
- Data consistency is important

**Example:**

```yaml
mcpServers:
  critical-database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    connectionMode: strict  # Must connect or fail startup
```

---

### Global --strict Flag

Override all server connection modes from the command line:

```bash
# Makes ALL servers strict, regardless of config
dexto --strict

# With specific agent
dexto --agent production-agent.yml --strict
```

**Use cases:**
- Production deployments requiring all services
- Integration testing with full infrastructure
- Fail-fast development environments

---

## Environment Variables

All MCP server configurations support environment variable expansion using `$VAR` or `${VAR}` syntax.

### Supported Fields

Environment variables can be used in:
- `command` - stdio command executable
- `args` - Each argument in the array
- `url` - Server endpoint URLs
- `headers` - Header values
- `env` - Environment variable values

### Syntax

```yaml
mcpServers:
  example:
    type: http
    url: $API_URL                          # Simple form
    headers:
      Authorization: Bearer ${API_TOKEN}   # Braces form
      X-Region: $REGION
```

### Security Best Practices

**✅ DO:**
```yaml
mcpServers:
  secure-service:
    type: http
    url: $SERVICE_URL
    headers:
      Authorization: Bearer $API_KEY       # Secure: from environment
```

**❌ DON'T:**
```yaml
mcpServers:
  insecure-service:
    type: http
    url: https://api.example.com
    headers:
      Authorization: Bearer sk-abc123...  # Never hardcode secrets!
```

### Loading Environment Variables

Dexto loads environment variables from:
1. System environment
2. `~/.dexto/.env` file (global)
3. Project `.dexto/.env` file (if in Dexto project)

**Example `.dexto/.env` file:**

```bash
# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# MCP Server Configuration
GITHUB_TOKEN=ghp_...
DATABASE_URL=postgresql://localhost:5432/mydb
ANALYTICS_API_URL=https://analytics.example.com/mcp
ANALYTICS_TOKEN=token_...
```

---

## Common Patterns

### Multiple Server Types

Combine different transport types based on your needs:

```yaml
mcpServers:
  # Local filesystem access
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    connectionMode: strict  # Required for agent

  # Local browser automation
  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
    connectionMode: lenient  # Optional

  # Remote analytics
  analytics:
    type: http
    url: $ANALYTICS_URL
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
    connectionMode: lenient  # Optional

  # Critical API
  core-api:
    type: http
    url: $CORE_API_URL
    headers:
      Authorization: Bearer $CORE_API_TOKEN
    connectionMode: strict  # Required for agent
```

---

### Development vs Production

Configure different behavior for different environments:

**Development (lenient, fast failure):**

```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    timeout: 10000          # Fail fast
    connectionMode: lenient  # Continue without DB

  external-api:
    type: http
    url: http://localhost:8080/mcp  # Local dev server
    timeout: 10000
    connectionMode: lenient
```

**Production (strict, longer timeouts):**

```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server@2.1.0"]  # Pinned version
    timeout: 60000          # Longer timeout for slow starts
    connectionMode: strict   # Must be available

  external-api:
    type: http
    url: $PRODUCTION_API_URL
    headers:
      Authorization: Bearer $PROD_API_TOKEN
    timeout: 45000
    connectionMode: strict   # Critical dependency
```

---

### Conditional Configuration

Use environment variables to enable/disable servers:

```yaml
mcpServers:
  # Always enabled
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

  # Enabled only when ENABLE_ANALYTICS is set
  analytics:
    type: http
    url: $ANALYTICS_URL  # Empty = server won't connect
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
    connectionMode: lenient
```

**Environment setup:**

```bash
# Disable analytics
unset ANALYTICS_URL

# Enable analytics
export ANALYTICS_URL=https://analytics.example.com/mcp
export ANALYTICS_TOKEN=token_...
```

---

## Tool Aggregation

When multiple MCP servers are configured, Dexto aggregates all their tools into a single tool set available to your agent.

### How It Works

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    # Provides: read_file, write_file, list_directory, etc.

  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
    # Provides: navigate, click, screenshot, etc.

  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: $GITHUB_TOKEN
    # Provides: create_issue, list_prs, get_commit, etc.
```

**Agent sees all tools:**
- `filesystem__read_file`
- `filesystem__write_file`
- `playwright__navigate`
- `playwright__screenshot`
- `github__create_issue`
- ... all tools from all servers

### Tool Naming

Tools are prefixed with their server name to avoid conflicts:

```
<server-name>__<tool-name>
```

**Example:**
- Server: `filesystem`
- Tool: `read_file`
- Aggregated name: `filesystem__read_file`

### Handling Conflicts

If multiple servers provide the same tool name, the server name prefix ensures uniqueness:

```yaml
mcpServers:
  local-storage:
    type: stdio
    command: ./local-storage-server
    # Provides: read_file, write_file

  cloud-storage:
    type: http
    url: $CLOUD_STORAGE_URL
    # Also provides: read_file, write_file
```

**Agent sees distinct tools:**
- `local_storage__read_file`
- `local_storage__write_file`
- `cloud_storage__read_file`
- `cloud_storage__write_file`

---

## Example Agent Configurations

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

systemPrompt: |
  You create content using filesystem tools to save files and Playwright
  to gather web research. Save all created content to the ./output directory.
```

---

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

systemPrompt: |
  You analyze data from the connected database and external analytics API.
  Always validate data before performing operations.
```

---

### DevOps Agent

```yaml
mcpServers:
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: $GITHUB_TOKEN
    connectionMode: strict

  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    connectionMode: strict

  deployment-api:
    type: http
    url: $DEPLOYMENT_API_URL
    headers:
      X-Deploy-Token: $DEPLOY_TOKEN
    timeout: 120000  # Deployments take time
    connectionMode: strict

systemPrompt: |
  You manage GitHub repositories, handle deployments, and maintain
  infrastructure configurations. Always verify before deploying.
```

---

## Troubleshooting

### Server Fails to Connect

**Stdio servers:**

```bash
# Test command manually
npx -y @modelcontextprotocol/server-filesystem .

# Check if command exists
which npx
which node
which python
```

**HTTP/SSE servers:**

```bash
# Test URL accessibility
curl $API_URL

# Check environment variables
echo $API_URL
echo $API_TOKEN
```

**Common fixes:**
- Verify command/URL is correct
- Check environment variables are set
- Ensure network connectivity
- Verify authentication credentials

---

### Timeout Errors

**Symptoms:**
- Server connection times out
- "Connection timeout" errors
- Slow server responses

**Solutions:**

```yaml
mcpServers:
  slow-service:
    type: http
    url: $SERVICE_URL
    timeout: 120000  # Increase timeout to 2 minutes
```

**Best practices:**
- Start with default 30s timeout
- Increase for known-slow services
- Use shorter timeouts in development for fast feedback
- Monitor timeout frequencies to identify problematic servers

---

### Authentication Failures

**Symptoms:**
- 401 Unauthorized errors
- 403 Forbidden errors
- "Invalid credentials" messages

**Debugging:**

```bash
# Check environment variables
echo $API_TOKEN
echo $GITHUB_TOKEN

# Verify .env file
cat ~/.dexto/.env

# Test authentication manually
curl -H "Authorization: Bearer $API_TOKEN" $API_URL
```

**Common issues:**
- Missing environment variables
- Expired tokens
- Wrong token format (e.g., missing "Bearer " prefix)
- Incorrect header names

---

### Tool Not Available

**Symptoms:**
- Agent says "I don't have access to that tool"
- Tool appears in server but not in agent

**Debugging steps:**

1. **Verify server is connected:**
   ```bash
   # Check agent logs for connection messages
   dexto --agent your-agent.yml
   ```

2. **List available tools:**
   - Use Web UI to inspect connected servers
   - Check MCP Manager API: `GET /api/mcp/servers`

3. **Check tool naming:**
   - Tools are prefixed: `<server-name>__<tool-name>`
   - Verify you're using the correct prefixed name

**Common fixes:**
- Ensure server is in `mcpServers` config
- Use correct tool name with server prefix
- Check server `connectionMode` (lenient failures are silent)
- Verify server actually provides that tool

---

### Environment Variable Not Expanding

**Symptoms:**
- Literal `$VAR` appears in URLs/commands
- "Variable not found" errors
- Authentication fails with env var references

**Debugging:**

```bash
# Check if variable is set
env | grep VAR_NAME

# Check .env file location
ls ~/.dexto/.env
cat ~/.dexto/.env

# Test variable expansion
echo $VAR_NAME
```

**Solutions:**
- Ensure `.env` file exists in correct location
- Use correct syntax: `$VAR` or `${VAR}`
- Restart agent after updating `.env`
- Check for typos in variable names

---

## Best Practices

### 1. Use Appropriate Connection Modes

```yaml
mcpServers:
  # Critical: strict mode
  database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    connectionMode: strict  # Agent cannot work without DB

  # Optional: lenient mode
  analytics:
    type: http
    url: $ANALYTICS_URL
    connectionMode: lenient  # Nice to have, not critical
```

---

### 2. Set Reasonable Timeouts

```yaml
mcpServers:
  # Fast local service: short timeout
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    timeout: 10000  # 10 seconds

  # Slow external API: longer timeout
  external-api:
    type: http
    url: $EXTERNAL_API_URL
    timeout: 60000  # 60 seconds
```

---

### 3. Document Server Purposes

```yaml
mcpServers:
  # Local filesystem operations for reading/writing project files
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

  # Web scraping and browser automation for research
  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
```

---

### 4. Group Related Servers

```yaml
mcpServers:
  # === Local Development Tools ===
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

  playwright:
    type: stdio
    command: npx
    args: ["-y", "@playwright/mcp@latest"]

  # === External APIs ===
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: $GITHUB_TOKEN

  analytics:
    type: http
    url: $ANALYTICS_URL
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
```

---

### 5. Pin Versions in Production

```yaml
mcpServers:
  # ❌ Development: unpinned
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]

  # ✅ Production: pinned version
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem@1.2.3"]
```

---

### 6. Use Environment Variables for Configuration

```yaml
# ✅ Good: Flexible and secure
mcpServers:
  api-service:
    type: http
    url: $API_URL
    headers:
      Authorization: Bearer $API_TOKEN

# ❌ Bad: Hardcoded and insecure
mcpServers:
  api-service:
    type: http
    url: https://api.example.com
    headers:
      Authorization: Bearer sk-abc123...
```

---

### 7. Test Server Connections

```bash
# Test stdio command
npx -y @modelcontextprotocol/server-filesystem .

# Test HTTP endpoint
curl -H "Authorization: Bearer $API_TOKEN" $API_URL

# Test with strict mode to catch issues early
dexto --agent your-agent.yml --strict
```

---

## Server Selection Guide

| Server Type | Use When | Pros | Cons |
|-------------|----------|------|------|
| **stdio** | Local tools, development, file ops | Fast, secure, full control | Requires local installation |
| **sse** | Legacy integrations, streaming | Efficient for live updates | Deprecated, limited support |
| **http** | Remote APIs, cloud services | Widely supported, robust | May have higher latency |

**Recommendations:**
- **Local development:** Use stdio servers for speed and simplicity
- **Cloud integrations:** Use HTTP servers for reliability
- **New projects:** Avoid SSE, use HTTP for remote servers
- **Legacy systems:** Keep SSE if already working, but plan migration to HTTP

---

## Contributing MCP Servers

Want to add your MCP server to Dexto's registry so users can easily discover and install it?

### WebUI Registry

Add your server to the built-in registry for one-click installation via Web UI:

1. Edit `src/app/webui/lib/server-registry-data.json`
2. Add your server entry following the schema
3. Submit a pull request

**Example entry:**

```json
{
  "id": "my-server",
  "name": "My MCP Server",
  "description": "Brief description",
  "category": "productivity",
  "config": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "my-mcp-server"]
  },
  "tags": ["tag1", "tag2"],
  "homepage": "https://github.com/user/my-mcp-server"
}
```

### Documentation

See [Contributing Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#1-adding-new-mcps-to-the-webui-registry) for detailed instructions.

---

## Related Documentation

**Agent Configuration:**
- [Agent Configuration Reference](./agent-yml.md) - Complete agent.yml reference
- [Tool Confirmation](./toolConfirmation.md) - Control MCP tool execution
- [Internal Tools](./internalTools.md) - Built-in Dexto tools
- [System Prompt](./systemPrompt.md) - Guide agents on MCP tool usage

**MCP Concepts:**
- [MCP Overview](../../mcp/overview.md) - What is MCP and why it matters
- [Configure Connections](../../mcp/connecting-servers.md) - Connection examples
- [MCP Manager](../../mcp/mcp-manager.md) - Runtime server management
- [Dexto as MCP Server](../../mcp/dexto-as-mcp-server.md) - Expose Dexto via MCP

**External Resources:**
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
- [MCP Documentation](https://modelcontextprotocol.io/)
