---
sidebar_position: 6
---

# Agent Configuration

API endpoints for managing agent configuration files, including reading, editing, validating, and exporting agent configurations.

## Get Agent File Path

*Returns metadata about the current agent configuration file.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/agent/path</code></p>

**Response:**
```json
{
  "path": "/absolute/path/to/agent.yml",
  "relativePath": "agent.yml",
  "name": "agent",
  "isDefault": false
}
```

## Get Agent Configuration

*Returns the raw agent configuration file content for editing. This endpoint returns the unprocessed YAML with environment variables in their original `$VAR` format.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/agent/config</code></p>

**Response:**
```json
{
  "yaml": "greeting: \"My Agent\"\nllm:\n  provider: openai\n  model: gpt-4o\n  apiKey: $OPENAI_API_KEY",
  "path": "/absolute/path/to/agent.yml",
  "relativePath": "agent.yml",
  "lastModified": "2025-01-15T10:30:00.000Z",
  "warnings": []
}
```

**Use Case:** Use this endpoint when you want to edit the agent configuration file directly. The returned YAML contains the raw file content exactly as it appears on disk.

## Save Agent Configuration

*Saves a new agent configuration to disk, validates it, and automatically restarts the agent if needed.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agent/config</code></p>

**Request Body:**
```json
{
  "yaml": "greeting: \"My Agent\"\nllm:\n  provider: openai\n  model: gpt-4o\n  apiKey: $OPENAI_API_KEY"
}
```

**Response:**
```json
{
  "ok": true,
  "path": "/absolute/path/to/agent.yml",
  "reloaded": true,
  "restarted": true,
  "changesApplied": ["llm"],
  "message": "Configuration saved and applied successfully (agent restarted)"
}
```

**Behavior:**
- Creates a backup of the current configuration before saving
- Validates YAML syntax and schema
- Writes the new configuration to disk
- Automatically detects what changed
- Restarts the agent if needed (e.g., LLM provider/model changes)
- Restores backup if save fails
- All event subscribers are automatically re-subscribed after restart

**Error Response (400):**
```json
{
  "ok": false,
  "issues": [
    {
      "code": "agent_invalid_config",
      "message": "llm.provider: Invalid enum value. Expected 'openai' | 'anthropic' | ...",
      "severity": "error"
    }
  ]
}
```

## Validate Agent Configuration

*Validates agent configuration YAML without saving it to disk.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agent/validate</code></p>

**Request Body:**
```json
{
  "yaml": "greeting: \"My Agent\"\nllm:\n  provider: openai\n  model: gpt-4o"
}
```

**Response (Valid):**
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "path": "llm.apiKey",
      "message": "No API key provided. Using environment variable OPENAI_API_KEY",
      "code": "missing_api_key"
    }
  ]
}
```

**Response (Invalid):**
```json
{
  "valid": false,
  "errors": [
    {
      "line": 3,
      "column": 15,
      "path": "llm.provider",
      "message": "Invalid enum value. Expected 'openai' | 'anthropic' | 'google' | ...",
      "code": "invalid_enum"
    }
  ],
  "warnings": []
}
```

**Use Case:** Use this endpoint to validate configuration changes before saving them. Perfect for implementing live validation in configuration editors.

## Export Effective Configuration

*Exports the effective runtime configuration with all environment variables resolved and secrets masked. Optionally supports session-specific configuration.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/agent/config/export</code></p>

**Query Parameters:**
- `sessionId` (optional): Export configuration for a specific session

**Response:**
```yaml
greeting: My Agent
llm:
  provider: openai
  model: gpt-4o
  apiKey: '[REDACTED]'
  router: vercel
  temperature: 0.7
  maxIterations: 10
mcpServers:
  filesystem:
    command: npx
    args:
      - '-y'
      - '@modelcontextprotocol/server-filesystem'
      - '/Users/username/Documents'
    env:
      API_KEY: '[REDACTED]'
```

**Content-Type:** `application/x-yaml`

**Use Case:** Use this endpoint when you want to:
- Export the current runtime configuration for inspection
- Download configuration for backup purposes
- View the effective configuration with all defaults and overrides applied
- Inspect session-specific configurations

**Key Differences from `/api/agent/config`:**
- `/api/agent/config` returns raw file content with `$ENVIRONMENT_VARIABLES`
- `/api/agent/config/export` returns effective runtime config with resolved values
- Export endpoint masks all sensitive data (API keys, secrets)
- Export endpoint applies all defaults and computed values

## Configuration Workflow

### Reading and Editing

1. **Get current config:** `GET /api/agent/config`
2. **Edit YAML locally**
3. **Validate changes:** `POST /api/agent/validate` with edited YAML
4. **Save if valid:** `POST /api/agent/config` with edited YAML
5. **Agent automatically restarts** if needed

### Exporting for Backup

1. **Export config:** `GET /api/agent/config/export`
2. **Download as YAML file**
3. **Store for backup/inspection**

### Session-Specific Configuration

Export effective configuration for a specific session:

```bash
curl http://localhost:3001/api/agent/config/export?sessionId=abc123
```

This returns the configuration as it applies to that particular session, including any session-specific overrides.
