---
sidebar_position: 6
---

# Search API

## Search Messages
*Searches for messages across all sessions or within a specific session.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/search/messages</code></p>

### Query Parameters
- `q` (string, required): Search query string
- `sessionId` (string, optional): Limit search to a specific session
- `role` (string, optional): Filter by message role (`user`, `assistant`, `system`, `tool`)
- `limit` (number, optional): Maximum number of results to return (default: 20)
- `offset` (number, optional): Number of results to skip for pagination (default: 0)

### Responses

#### Success (200)
```json
{
  "results": [
    {
      "sessionId": "b4a2a3e8-72b1-4d00-a5c3-1a2c3d4e5f6a",
      "message": {
        "role": "user",
        "content": "Hello, how are you?"
      },
      "matchedText": "Hello",
      "context": "Hello, how are you?",
      "messageIndex": 0
    }
  ],
  "total": 1,
  "hasMore": false,
  "query": "Hello",
  "options": {
    "limit": 20,
    "offset": 0
  }
}
```

#### Error (400)
```json
{
  "error": "Search query is required"
}
```

## Search Sessions
*Searches for sessions that contain the specified query.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/search/sessions</code></p>

### Query Parameters
- `q` (string, required): Search query string

### Responses

#### Success (200)
```json
{
  "results": [
    {
      "sessionId": "b4a2a3e8-72b1-4d00-a5c3-1a2c3d4e5f6a",
      "matchCount": 3,
      "firstMatch": {
        "sessionId": "b4a2a3e8-72b1-4d00-a5c3-1a2c3d4e5f6a",
        "message": {
          "role": "user",
          "content": "Hello, how are you?"
        },
        "matchedText": "Hello",
        "context": "Hello, how are you?",
        "messageIndex": 0
      },
      "metadata": {
        "createdAt": 1698408000000,
        "lastActivity": 1698408300000,
        "messageCount": 4
      }
    }
  ],
  "total": 1,
  "hasMore": false,
  "query": "Hello"
}
```

#### Error (400)
```json
{
  "error": "Search query is required"
}
```

## Example Usage

### Basic Message Search
```bash
curl "http://localhost:3001/api/search/messages?q=hello"
```

### Search with Filters
```bash
curl "http://localhost:3001/api/search/messages?q=error&role=assistant&limit=10"
```

### Search within Specific Session
```bash
curl "http://localhost:3001/api/search/messages?q=deploy&sessionId=b4a2a3e8-72b1-4d00-a5c3-1a2c3d4e5f6a"
```

### Search Sessions
```bash
curl "http://localhost:3001/api/search/sessions?q=project"
```