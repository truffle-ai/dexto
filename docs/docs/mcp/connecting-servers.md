---
sidebar_position: 2
title: Configure MCP Connections
sidebar_label: "Configure Connections"
description: How to connect Dexto to MCP servers via stdio, http, and sse, with examples and best practices.
---

# Configuring MCP Connections

The `mcpServers` section defines the Model Context Protocol (MCP) servers that your Dexto Agent can use for tool execution.

Dexto supports three types of MCP server connections:
- **Local servers** (`stdio`) - Launch processes on your machine
- **Remote servers** (`sse`) - Connect via Server-Sent Events over HTTP
- **HTTP servers** (`http`) - Connect via streamable HTTP transport

## Local MCP Server (stdio)

Local MCP servers use the `stdio` type to launch a process on your machine. This is useful for integrating with local tools or scripts.

**TypeScript interface:**
```typescript
export interface StdioServerConfig {
    type: 'stdio';
    command: string;
    args: string[];
    env?: Record<string, string>;
    timeout?: number; // in milliseconds
    connectionMode?: 'strict' | 'lenient'; // defaults to 'lenient'
}
```

**Field explanations:**
- `type`: Must be `'stdio'` for local servers
- `command`: The shell command to launch the server (e.g., `node`, `npx`)
- `args`: Array of arguments for the command
- `env` (optional): Environment variables for the server process
- `timeout` (optional): Timeout in milliseconds for server startup or communication
- `connectionMode` (optional): Connection requirement mode - `'strict'` requires successful connection, `'lenient'` allows failures (defaults to `'lenient'`)

**Example:**
```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
    connectionMode: strict  # This server must connect successfully
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"
```

## Remote MCP Server (sse)

:::note
SSE is on the deprecation path. We recommend using the [`http`](#http-mcp-server-http) type instead.
:::

Remote MCP servers use the `sse` type to connect to a server over HTTP using Server-Sent Events. This is useful for cloud-hosted or remote tool integrations.

**TypeScript interface:**
```typescript
export interface SSEServerConfig {
    type: 'sse';
    url: string;
    headers?: Record<string, string>;
    timeout?: number; // in milliseconds
    connectionMode?: 'strict' | 'lenient'; // defaults to 'lenient'
}
```

**Field explanations:**
- `type`: Must be `'sse'` for Server-Sent Events servers
- `url`: The URL of the remote MCP server
- `headers` (optional): HTTP headers to send with the connection (e.g., for authentication)
- `timeout` (optional): Timeout in milliseconds for server communication
- `connectionMode` (optional): Connection requirement mode - `'strict'` requires successful connection, `'lenient'` allows failures (defaults to `'lenient'`)

**Example:**
```yaml
mcpServers:
  remote-llm:
    type: sse
    url: https://api.example.com/mcp-server
    headers:
      Authorization: Bearer $REMOTE_LLM_TOKEN
      User-Agent: Dexto/1.0
    timeout: 60000
```

## HTTP MCP Server (http)

HTTP MCP servers use the `http` type to connect via streamable HTTP transport. This provides a reliable HTTP-based connection for MCP servers that support this protocol.

**TypeScript interface:**
```typescript
export interface HttpServerConfig {
    type: 'http';
    baseUrl: string;
    headers?: Record<string, string>;
    timeout?: number; // in milliseconds
    connectionMode?: 'strict' | 'lenient'; // defaults to 'lenient'
}
```

**Field explanations:**
- `type`: Must be `'http'` for HTTP transport servers
- `baseUrl`: The base URL of the HTTP MCP server
- `headers` (optional): HTTP headers to send with requests (e.g., for authentication)
- `timeout` (optional): Timeout in milliseconds for server communication
- `connectionMode` (optional): Connection requirement mode - `'strict'` requires successful connection, `'lenient'` allows failures (defaults to `'lenient'`)

**Example:**
```yaml
mcpServers:
  api-server:
    type: http
    baseUrl: https://mcp.api.example.com
    headers:
      Authorization: Bearer $API_TOKEN
      Content-Type: application/json
    timeout: 45000
```

## Mixed Configuration Examples

### Example with all server types

```yaml
mcpServers:
  # Local filesystem access
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
    timeout: 30000

  # Remote SSE server
  remote-analytics:
    type: sse
    url: https://analytics.example.com/mcp-sse
    headers:
      Authorization: Bearer $ANALYTICS_TOKEN
    timeout: 60000

  # HTTP-based API server
  external-api:
    type: http
    baseUrl: https://api.external-service.com/mcp
    headers:
      Authorization: Bearer $EXTERNAL_API_TOKEN
      X-Client-Version: "1.0"
    timeout: 45000
```

### Example with environment variables

```yaml
mcpServers:
  database:
    type: stdio
    command: npx
    args:
      - -y
      - "@truffle-ai/database-server"
    env:
      DATABASE_URL: $DATABASE_URL
      LOG_LEVEL: info
    timeout: 30000

  cloud-service:
    type: http
    baseUrl: $CLOUD_SERVICE_URL
    headers:
      Authorization: Bearer $CLOUD_SERVICE_TOKEN
    timeout: 60000
```

## Server Selection Guidelines

| Server Type | Use Case | Pros | Cons |
|-------------|----------|------|------|
| **stdio** | Local tools, development, file operations | Fast, secure, full control | Requires local installation |
| **sse** | Real-time events, streaming data | Efficient for live updates | Limited to SSE-compatible servers |
| **http** | RESTful APIs, reliable connections | Widely supported, robust | May have higher latency |

## Connection Modes

Each MCP server can be configured with a `connectionMode` that determines how Dexto handles connection failures:

- **`strict`**: The server must connect successfully or Dexto will fail to start
- **`lenient`** (default): The server can fail to connect and Dexto will continue running

### Per-Server Configuration

```yaml
mcpServers:
  critical-database:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/database-server"]
    connectionMode: strict  # Must connect or fail startup
  
  optional-analytics:
    type: http
    baseUrl: https://analytics.example.com/mcp
    connectionMode: lenient  # Can fail without breaking startup
```

### Global --strict Flag

You can override all server connection modes using the `--strict` CLI flag:

```bash
dexto --strict  # Makes ALL servers strict, regardless of config
```

This is useful for production environments where you want to ensure all configured servers are available.

## Best Practices

1. **Use environment variables** for sensitive data like API keys and tokens
2. **Set appropriate timeouts** based on expected server response times
3. **Group related servers** logically in your configuration
4. **Test server connections** during development with appropriate fallbacks
5. **Document server purposes** in comments for team collaboration
6. **Use `strict` mode for critical servers** that your agent depends on
7. **Use `lenient` mode for optional enhancements** like analytics or debugging tools

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| `stdio` server fails to start | Check if command and args are correct, verify file paths |
| `sse` connection drops | Verify URL accessibility, check network/firewall settings |
| `http` server timeouts | Increase timeout value, verify server availability |
| Authentication failures | Verify tokens/credentials, check header format |

### Debug Tips

- Enable debug logging to see detailed connection attempts
- Test server URLs independently before adding to configuration
- Use shorter timeouts during development to fail fast
- Verify environment variables are properly set and accessible

## Contributing MCPs

Want to add your MCP to our WebUI registry so other users can easily discover and install it? Check out our [Community Contribution Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#1-adding-new-mcps-to-the-webui-registry) for step-by-step instructions.

## Additional Resources

- [Dexto GitHub repository examples](https://github.com/truffle-ai/dexto/tree/main/agents/examples) - More configuration examples
- [Model Context Protocol specification](https://spec.modelcontextprotocol.io/) - Official MCP documentation
- [Available MCP servers](https://github.com/modelcontextprotocol/servers) - Community-maintained server list
- [Community Contribution Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#contributing-mcps-and-example-agents) - How to contribute MCPs and example agents

## Notes

- You can define as many servers as needed, each with a unique name
- Server names should be descriptive and follow consistent naming conventions
- Mixed server types can be used simultaneously in the same configuration
- All server types support optional timeout configuration for reliable operation 
