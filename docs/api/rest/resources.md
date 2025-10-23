---
sidebar_position: 9
---

# Resource Management

## List All Resources
*Retrieves a list of all available resources from all sources (MCP servers and internal providers).*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/resources</code></p>

### Responses

#### Success (200)
```json
{
  "ok": true,
  "resources": [
    {
      "uri": "fs:///Users/example/project/file.txt",
      "name": "file.txt",
      "description": "Project documentation",
      "mimeType": "text/plain",
      "source": "internal",
      "size": 1024,
      "lastModified": "2023-10-27T10:00:00.000Z"
    },
    {
      "uri": "mcp:weather-server:forecast",
      "name": "Weather Forecast",
      "description": "Current weather forecast data",
      "mimeType": "application/json",
      "source": "mcp",
      "serverName": "weather-server"
    }
  ]
}
```

## Read Resource Content
*Reads the content of a specific resource by its URI. The resource ID in the URL must be URI-encoded.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/resources/:resourceId/content</code></p>

### URL Parameters
- `resourceId` (string, required): The URI-encoded resource identifier (e.g., `fs%3A%2F%2F%2Fpath%2Fto%2Ffile.txt` for `fs:///path/to/file.txt`)

### Responses

#### Success (200)
```json
{
  "ok": true,
  "content": {
    "contents": [
      {
        "uri": "fs:///path/to/file.txt",
        "mimeType": "text/plain",
        "text": "File content here..."
      }
    ],
    "_meta": {
      "size": 1024
    }
  }
}
```

#### Binary File Response (200)
```json
{
  "ok": true,
  "content": {
    "contents": [
      {
        "uri": "fs:///path/to/image.png",
        "mimeType": "image/png",
        "text": "[Binary file: image.png (15234 bytes)]"
      }
    ],
    "_meta": {
      "isBinary": true,
      "size": 15234,
      "originalMimeType": "image/png"
    }
  }
}
```

#### Error (404)
```json
{
  "error": "Resource not found"
}
```

## Check Resource Exists
*Checks if a resource exists by its URI without retrieving its content.*

<p class="api-endpoint-header"><span class="api-method head">HEAD</span><code>/api/resources/:resourceId</code></p>

### URL Parameters
- `resourceId` (string, required): The URI-encoded resource identifier

### Responses

#### Resource Exists (200)
- Empty response body

#### Resource Not Found (404)
- Empty response body

## List Server Resources
*Retrieves all resources available from a specific MCP server.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/mcp/servers/:serverId/resources</code></p>

### URL Parameters
- `serverId` (string, required): The ID of the MCP server

### Responses

#### Success (200)
```json
{
  "success": true,
  "resources": [
    {
      "uri": "forecast",
      "name": "Weather Forecast",
      "originalUri": "forecast",
      "serverName": "weather-server"
    },
    {
      "uri": "historical",
      "name": "Historical Data",
      "originalUri": "historical",
      "serverName": "weather-server"
    }
  ]
}
```

#### Error (404)
```json
{
  "error": "Server not found"
}
```

## Read Server Resource Content
*Reads content from a specific resource on an MCP server. This endpoint automatically constructs the qualified URI format (`mcp:serverId:resourceId`).*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/mcp/servers/:serverId/resources/:resourceId/content</code></p>

### URL Parameters
- `serverId` (string, required): The ID of the MCP server
- `resourceId` (string, required): The URI-encoded resource identifier on that server

### Responses

#### Success (200)
```json
{
  "success": true,
  "data": {
    "content": {
      "contents": [
        {
          "uri": "mcp:weather-server:forecast",
          "mimeType": "application/json",
          "text": "{\"temperature\": 72, \"conditions\": \"sunny\"}"
        }
      ]
    }
  }
}
```

#### Error (404)
```json
{
  "error": "Resource not found"
}
```

## Resource URI Formats

Resources use URI schemes to identify their source:

- **MCP Resources**: `mcp:serverId:resourceId` (e.g., `mcp:weather-server:forecast`)
- **File System Resources**: `fs:///absolute/path/to/file` (e.g., `fs:///Users/example/file.txt`)
- **Blob Resources**: `blob:blobId` (e.g., `blob:abc123`)

When using the generic `/api/resources/:resourceId/content` endpoint, the full URI must be URI-encoded. When using server-specific endpoints (`/api/mcp/servers/:serverId/resources/:resourceId/content`), only the resource ID portion needs to be encoded.

## Resource Metadata Fields

Resources may include the following metadata fields:

- `uri` (string): Unique identifier for the resource
- `name` (string, optional): Human-readable name
- `description` (string, optional): Description of the resource content
- `mimeType` (string, optional): MIME type of the content
- `source` (string): Source type (`mcp` or `internal`)
- `serverName` (string, optional): Origin server name for MCP resources
- `size` (number, optional): Size in bytes
- `lastModified` (string, optional): ISO 8601 timestamp of last modification
- `metadata` (object, optional): Additional provider-specific metadata
