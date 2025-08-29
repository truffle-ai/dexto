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

### LLM Catalog
*Providers, models, capabilities, and API key status.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/llm/catalog</code></p>

#### Query Parameters
- `provider`: comma-separated providers (e.g., `openai,anthropic`).
- `hasKey`: filter by key presence (`true` | `false`).
- `router`: `vercel` | `in-built`.
- `fileType`: `audio` | `pdf`.
- `defaultOnly`: include only default models (`true` | `false`).
- `mode`: `grouped` (default) or `flat`.

#### Responses
**Success (200)**
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
        {"name":"gpt-4o","default":false,"maxInputTokens":128000,"supportedFileTypes":["pdf"]}
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
      "name": "gpt-4o",
      "default": false,
      "maxInputTokens": 128000,
      "supportedFileTypes": ["pdf"],
      "supportedRouters": ["vercel", "in-built"]
    }
  ]
}
```

### Save Provider API Key
*Stores an API key for a provider in .env and makes it available immediately.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/llm/key</code></p>

#### Request Body
```json
{"provider":"openai","apiKey":"sk-..."}
```

#### Responses
**Success (200)**
```json
{"ok":true,"provider":"openai","envVar":"OPENAI_API_KEY"}
```

Note: request body size is limited (4KB).

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
