---
sidebar_position: 8
---

# Prompts

Manage and execute custom prompts with optional resource attachments.

## List Prompts
*Retrieves all available prompts, including both built-in and custom prompts.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/prompts</code></p>

### Responses

#### Success (200)
```json
{
  "prompts": [
    {
      "name": "analyze-code",
      "description": "Analyze code for issues",
      "arguments": [
        {
          "name": "language",
          "description": "Programming language",
          "required": true
        }
      ],
      "source": "custom"
    }
  ]
}
```

## Get Prompt Definition
*Fetches the definition for a specific prompt.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/prompts/:name</code></p>

### Responses

#### Success (200)
```json
{
  "definition": {
    "name": "analyze-code",
    "description": "Analyze code for issues",
    "arguments": [
      {
        "name": "language",
        "description": "Programming language",
        "required": true
      }
    ]
  }
}
```

#### Error (404)
```json
{
  "error": "Prompt not found"
}
```

## Resolve Prompt
*Resolves a prompt template with provided arguments and returns the final text with resources.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/prompts/:name/resolve</code></p>

### Query Parameters
- `context` (string, optional): Additional context for prompt resolution.
- `args` (object, optional): Arguments to substitute in the prompt template. Pass as a JSON string.

### Example Request
```
GET /api/prompts/analyze-code/resolve?args={"language":"TypeScript"}
```

### Responses

#### Success (200)
```json
{
  "text": "Analyze this TypeScript code...",
  "resources": [
    "mcp:server-name:resource-uri"
  ]
}
```

#### Error (400)
```json
{
  "error": "Missing required argument: language"
}
```

## Create Custom Prompt
*Creates a new custom prompt with optional resource attachment. Maximum request size: 10MB.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/prompts/custom</code></p>

### Request Body
- `name` (string, required): Unique name for the custom prompt.
- `title` (string, optional): Display title for the prompt.
- `description` (string, optional): Description of what the prompt does.
- `content` (string, required): The prompt content text. Can include `{{argumentName}}` placeholders.
- `arguments` (array, optional): Array of argument definitions.
  - `name` (string, required): Argument name.
  - `description` (string, optional): Argument description.
  - `required` (boolean, optional): Whether the argument is required. Default: `false`.
- `resource` (object, optional): Attach a resource to this prompt.
  - `base64` (string, required): Base64-encoded resource data.
  - `mimeType` (string, required): MIME type of the resource (e.g., `text/plain`, `application/pdf`).
  - `filename` (string, optional): Resource filename.

### Example Request
```json
{
  "name": "review-pr",
  "description": "Review pull request code",
  "content": "Review this {{language}} pull request...",
  "arguments": [
    {
      "name": "language",
      "description": "Programming language",
      "required": true
    }
  ],
  "resource": {
    "base64": "Y29kZSBjb250ZW50IGhlcmU=",
    "mimeType": "text/plain",
    "filename": "pr.diff"
  }
}
```

### Responses

#### Success (201)
```json
{
  "prompt": {
    "name": "review-pr",
    "description": "Review pull request code",
    "arguments": [
      {
        "name": "language",
        "description": "Programming language",
        "required": true
      }
    ],
    "source": "custom"
  }
}
```

#### Error (400)
```json
{
  "error": "Prompt name already exists"
}
```

#### Error (413)
```json
{
  "error": "Request body too large. Maximum size: 10MB"
}
```

## Delete Custom Prompt
*Permanently deletes a custom prompt. Built-in prompts cannot be deleted.*

<p class="api-endpoint-header"><span class="api-method delete">DELETE</span><code>/api/prompts/custom/:name</code></p>

### Responses

#### Success (204)
*No content returned.*

#### Error (404)
```json
{
  "error": "Prompt not found"
}
```

#### Error (400)
```json
{
  "error": "Cannot delete built-in prompt"
}
```
