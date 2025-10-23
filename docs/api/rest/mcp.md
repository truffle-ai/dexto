---
sidebar_position: 3
---

# MCP Management

### List MCP Servers
*Gets a list of all connected and failed MCP servers.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/mcp/servers</code></p>

#### Responses

**Success (200)**
```json
{
  "servers": [
    { "id": "filesystem", "name": "filesystem", "status": "connected" },
    { "id": "database", "name": "database", "status": "error" }
  ]
}
```

### Add MCP Server
*Connects a new MCP server dynamically.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/mcp/servers</code></p>

#### Request Body
- `name` (string, required): A unique name for the server.
- `config` (object, required): The server's configuration object, including optional `connectionMode`.

**Example Request Body:**
```json
{
  "name": "filesystem",
  "config": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
    "timeout": 30000,
    "connectionMode": "strict"
  }
}
```

#### Responses
**Success (201)**
```json
{
  "status": "connected",
  "name": "new-server"
}
```

### List Server Tools
*Retrieves the list of tools available on a specific MCP server.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/mcp/servers/:serverId/tools</code></p>

#### Responses
**Success (200)**
```json
{
  "tools": [
    {
      "id": "readFile",
      "name": "readFile",
      "description": "Read the contents of a file",
      "inputSchema": {
          "type": "object",
          "properties": { "path": { "type": "string" } }
      }
    }
  ]
}
```

### Execute MCP Tool
*Executes a tool on an MCP server directly.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/mcp/servers/:serverId/tools/:toolName/execute</code></p>

#### Request Body
- An object containing the arguments required by the tool.

#### Responses

**Success (200)**
```json
{
  "success": true,
  "data": {
    "fileContent": "..."
  }
}
```

**Error (500)**
```json
{
  "success": false,
  "error": "Tool execution failed: ..."
}
```

### Restart MCP Server
*Restarts a connected MCP server.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/mcp/servers/:serverId/restart</code></p>

#### Responses

**Success (200)**
```json
{
  "status": "restarted",
  "serverId": "filesystem"
}
```

**Error (404)**
```json
{
  "error": "Server not found"
}
```

**Error (500)**
```json
{
  "error": "Failed to restart server: <error details>"
}
```

### Remove MCP Server
*Disconnects and removes an MCP server.*

<p class="api-endpoint-header"><span class="api-method delete">DELETE</span><code>/api/mcp/servers/:serverId</code></p>

#### Responses
**Success (200)**
```json
{
  "status": "disconnected",
  "id": "server-to-remove"
}
```
