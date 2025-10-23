---
sidebar_position: 4
---

# LLM Configuration

## Get Current LLM Config
*Retrieves the current LLM configuration.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/llm/current</code></p>

### Query Parameters
- `sessionId` (string, optional): Session identifier to retrieve session-specific LLM configuration

### Responses
#### Success (200)
```json
{
  "config": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "displayName": "GPT-4.1 Mini",
    "router": "vercel"
  }
}
```

## LLM Catalog
*Providers, models, capabilities, and API key status.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/llm/catalog</code></p>

### Query Parameters
- `provider`: comma-separated providers (e.g., `openai,anthropic`).
- `hasKey`: filter by key presence (`true` | `false`).
- `router`: `vercel` | `in-built`.
- `fileType`: `audio` | `pdf` | `image`.
- `defaultOnly`: include only default models (`true` | `false`).
- `mode`: `grouped` (default) or `flat`.

### Responses
#### Success (200)
```json
{
  "providers": {
    "openai": {
      "name": "Openai",
      "hasApiKey": false,
      "primaryEnvVar": "OPENAI_API_KEY",
      "supportedRouters": ["in-built", "vercel"],
      "supportsBaseURL": false,
      "models": [
        {"name":"gpt-4.1-mini","displayName":"GPT-4.1 Mini","default":true,"maxInputTokens":1048576,"supportedFileTypes":["pdf","image"]}
      ]
    }
  }
}
```

When `mode=flat`, response is:
```json
{
  "models": [
    {
      "provider": "openai",
      "name": "gpt-4.1-mini",
      "displayName": "GPT-4.1 Mini",
      "default": true,
      "maxInputTokens": 1048576,
      "supportedFileTypes": ["pdf", "image"],
      "supportedRouters": ["vercel", "in-built"]
    }
  ]
}
```

## Save Provider API Key
*Stores an API key for a provider in .env and makes it available immediately.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/llm/key</code></p>

### Request Body
```json
{"provider":"openai","apiKey":"sk-..."}
```

### Responses
#### Success (200)
```json
{"ok":true,"provider":"openai","envVar":"OPENAI_API_KEY"}
```

Note: request body size is limited (4KB).

## Switch LLM
*Switches the LLM configuration.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/llm/switch</code></p>

### Request Body
- `provider` (string, optional): LLM provider identifier (e.g., `openai`, `anthropic`)
- `model` (string, optional): Model name (e.g., `gpt-4.1-mini`, `claude-sonnet-4-5-20250929`)
- `router` ("vercel" | "in-built", optional): Router to use for LLM requests
- `apiKey` (string, optional): API key or environment variable reference
- `baseURL` (string, optional): Custom base URL for OpenAI-compatible providers
- `maxInputTokens` (number, optional): Maximum input tokens override
- `sessionId` (string, optional): Session identifier for session-specific LLM configuration

### Responses

#### Success (200)
```json
{
  "config": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "router": "vercel"
  },
  "sessionId": "session-123"
}
```

#### Error (400)
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
