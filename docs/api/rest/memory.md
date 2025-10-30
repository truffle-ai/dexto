---
sidebar_position: 12
---

# Memory Management

## List Memories
*Retrieves a list of all memories with optional filtering.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/memory</code></p>

### Query Parameters
- `tags` (string, optional): Comma-separated list of tags to filter by. Memories matching any of the tags will be returned.
- `source` (string, optional): Filter by source. Valid values: `user`, `system`.
- `pinned` (string, optional): Filter by pinned status. Valid values: `true`, `false`.
- `limit` (number, optional): Maximum number of memories to return. Must be a positive integer.
- `offset` (number, optional): Number of memories to skip. Must be a non-negative integer.

### Responses

#### Success (200)
```json
{
  "ok": true,
  "memories": [
    {
      "id": "a1b2c3d4e5f6",
      "content": "Remember to use async/await for database operations",
      "tags": ["development", "best-practices"],
      "metadata": {
        "source": "user",
        "pinned": true
      },
      "createdAt": 1698393600000,
      "updatedAt": 1698393600000
    }
  ],
  "count": 1
}
```

## Get Memory Count
*Returns the total count of memories matching the specified filters.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/memory/count</code></p>

### Query Parameters
- `tags` (string, optional): Comma-separated list of tags to filter by.
- `source` (string, optional): Filter by source. Valid values: `user`, `system`.
- `pinned` (string, optional): Filter by pinned status. Valid values: `true`, `false`.

### Responses

#### Success (200)
```json
{
  "ok": true,
  "count": 42
}
```

## Get Memory by ID
*Retrieves a specific memory by its unique identifier.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/memory/:id</code></p>

### Responses

#### Success (200)
```json
{
  "ok": true,
  "memory": {
    "id": "a1b2c3d4e5f6",
    "content": "Remember to use async/await for database operations",
    "tags": ["development", "best-practices"],
    "metadata": {
      "source": "user",
      "pinned": true
    },
    "createdAt": 1698393600000,
    "updatedAt": 1698393600000
  }
}
```

#### Error (404)
```json
{
  "code": "memory_not_found",
  "message": "Memory not found: a1b2c3d4e5f6",
  "scope": "memory",
  "type": "not_found",
  "context": {
    "id": "a1b2c3d4e5f6"
  }
}
```

## Create Memory
*Creates a new memory.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/memory</code></p>

### Request Body
- `content` (string, required): The memory content. Must be between 1 and 10,000 characters.
- `tags` (array of strings, optional): Tags for categorization. Maximum 10 tags, each 1-50 characters.
- `metadata` (object, optional): Additional metadata including:
  - `source` (string, optional): Source of the memory. Valid values: `user`, `system`.
  - `pinned` (boolean, optional): Whether this memory should be pinned for auto-loading.
  - Additional custom fields are allowed.

### Example Request
```json
{
  "content": "Always validate user input with Zod schemas",
  "tags": ["security", "validation"],
  "metadata": {
    "source": "user",
    "pinned": true
  }
}
```

### Responses

#### Success (201)
```json
{
  "ok": true,
  "memory": {
    "id": "g7h8i9j0k1l2",
    "content": "Always validate user input with Zod schemas",
    "tags": ["security", "validation"],
    "metadata": {
      "source": "user",
      "pinned": true
    },
    "createdAt": 1698397200000,
    "updatedAt": 1698397200000
  }
}
```

#### Error (400)
```json
{
  "name": "DextoValidationError",
  "message": "String must contain at most 10000 character(s)",
  "issues": [
    {
      "code": "too_big",
      "path": ["content"],
      "message": "String must contain at most 10000 character(s)",
      "severity": "error"
    }
  ],
  "errorCount": 1,
  "warningCount": 0
}
```

## Update Memory
*Updates an existing memory. Only provided fields will be updated.*

<p class="api-endpoint-header"><span class="api-method put">PUT</span><code>/api/memory/:id</code></p>

### Request Body
- `content` (string, optional): Updated content. Must be between 1 and 10,000 characters.
- `tags` (array of strings, optional): Updated tags (replaces existing tags). Maximum 10 tags, each 1-50 characters.
- `metadata` (object, optional): Updated metadata (merges with existing metadata).

### Example Request
```json
{
  "content": "Always validate user input with Zod schemas and provide clear error messages",
  "tags": ["security", "validation", "error-handling"]
}
```

### Responses

#### Success (200)
```json
{
  "ok": true,
  "memory": {
    "id": "g7h8i9j0k1l2",
    "content": "Always validate user input with Zod schemas and provide clear error messages",
    "tags": ["security", "validation", "error-handling"],
    "metadata": {
      "source": "user",
      "pinned": true
    },
    "createdAt": 1698397200000,
    "updatedAt": 1698400800000
  }
}
```

#### Error (404)
```json
{
  "code": "memory_not_found",
  "message": "Memory not found: g7h8i9j0k1l2",
  "scope": "memory",
  "type": "not_found",
  "context": {
    "id": "g7h8i9j0k1l2"
  }
}
```

## Delete Memory
*Permanently deletes a memory. This action cannot be undone.*

<p class="api-endpoint-header"><span class="api-method delete">DELETE</span><code>/api/memory/:id</code></p>

### Responses

#### Success (200)
```json
{
  "ok": true,
  "message": "Memory deleted successfully"
}
```

#### Error (404)
```json
{
  "code": "memory_not_found",
  "message": "Memory not found: a1b2c3d4e5f6",
  "scope": "memory",
  "type": "not_found",
  "context": {
    "id": "a1b2c3d4e5f6"
  }
}
```

## Validation Rules

### Content
- Required when creating a memory
- Must be between 1 and 10,000 characters
- Cannot be empty

### Tags
- Optional
- Maximum 10 tags per memory
- Each tag must be between 1 and 50 characters
- Tags are replaced entirely when updating (not merged)

### Metadata
- Optional
- Supports `source` (`user` or `system`)
- Supports `pinned` (boolean)
- Additional custom fields are allowed
- Metadata is merged when updating (not replaced)

### Filtering
- Tag filtering uses OR logic (memory matches if it has any of the specified tags)
- All filters can be combined
- Results are sorted by `updatedAt` in descending order (most recent first)
- Pagination is applied after filtering and sorting
