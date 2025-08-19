---
sidebar_position: 4
---

# LLM Configuration

### Get Current LLM Config
*Retrieves the current LLM configuration.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/llm/current</code></p>

#### Responses
**Success (200)**
```json
{
  "config": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

### List LLM Providers
*Gets a list of all available LLM providers and their models.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/llm/providers</code></p>

#### Responses
**Success (200)**
```json
{
  "providers": {
    "openai": {
      "name": "Openai",
      "models": ["gpt-4o", "gpt-4-turbo"],
      "supportedRouters": ["in-built", "vercel"],
      "supportsBaseURL": true
    },
    "cohere": {
      "name": "Cohere",
      "models": ["command-r-plus", "command-r", "command", "command-light"],
      "supportedRouters": ["vercel"],
      "supportsBaseURL": false
    }
  }
}
```

### Switch LLM
*Switches the LLM configuration.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/llm/switch</code></p>

#### Request Body
- `provider` (string, optional)
- `model` (string, optional)
- `router` ("vercel" | "in-built", optional)
- `apiKey` (string, optional)
- `baseURL` (string, optional)
- `maxInputTokens` (number, optional)
- `sessionId` (string, optional)

#### Responses

**Success (200)**
```json
{
  "ok": true,
  "data": {
    "provider": "openai",
    "model": "gpt-4o",
    "router": "vercel"
  },
  "issues": []
}
```

**Error (400)**
```json
{
  "ok": false,
  "issues": [
    {
      "code": "schema_validation",
      "message": "...",
      "path": ["provider"],
      "severity": "error",
      "context": {"field": "provider"}
    }
  ]
}
```
