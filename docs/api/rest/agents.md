---
sidebar_position: 10
---

# Agent Management

## List Agents
*Retrieves all agents (installed, available, and current active agent).*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/agents</code></p>

### Responses

#### Success (200)
```json
{
  "installed": [
    {
      "id": "default",
      "name": "Default",
      "description": "Default Dexto agent",
      "author": "Dexto",
      "tags": ["general", "assistant"],
      "type": "builtin"
    }
  ],
  "available": [
    {
      "id": "music-agent",
      "name": "Music Agent",
      "description": "AI agent for music creation and audio processing",
      "author": "Truffle AI",
      "tags": ["music", "audio", "creation", "sound"],
      "type": "builtin"
    }
  ],
  "current": {
    "id": "default",
    "name": "Default"
  }
}
```

## Get Current Agent
*Retrieves the currently active agent.*

<p class="api-endpoint-header"><span class="api-method get">GET</span><code>/api/agents/current</code></p>

### Responses

#### Success (200)
```json
{
  "id": "default",
  "name": "Default"
}
```

When no agent is active:
```json
{
  "id": null,
  "name": null
}
```

## Install Agent
*Installs an agent from the registry or from a custom source.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agents/install</code></p>

### Request Body (Registry Agent)
```json
{
  "id": "music-agent"
}
```

### Request Body (Custom Agent)
```json
{
  "id": "my-custom-agent",
  "name": "My Custom Agent",
  "sourcePath": "/path/to/agent.yml",
  "metadata": {
    "description": "Custom agent for specialized tasks",
    "author": "John Doe",
    "tags": ["custom", "specialized"],
    "main": "agent.yml"
  },
  "injectPreferences": true
}
```

**Parameters:**
- `id` (string, required): Unique agent identifier (lowercase, hyphens only for custom agents)
- `name` (string, optional): Display name (defaults to derived from id)
- `sourcePath` (string, required for custom): Path to agent configuration file or directory
- `metadata` (object, required for custom):
  - `description` (string, required): Human-readable description
  - `author` (string, required): Agent author or organization
  - `tags` (string[], optional): Tags for categorizing the agent
  - `main` (string, optional): Main configuration file name within source directory
- `injectPreferences` (boolean, default: true): Whether to inject user preferences into agent config

### Responses

#### Success (201) - Registry Agent
```json
{
  "installed": true,
  "id": "music-agent",
  "name": "Music Agent",
  "type": "builtin"
}
```

**Success (201) - Custom Agent**
```json
{
  "installed": true,
  "id": "my-custom-agent",
  "name": "My Custom Agent",
  "type": "custom"
}
```

## Switch Agent
*Switches to a different agent by ID or file path.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agents/switch</code></p>

### Request Body
```json
{
  "id": "database-agent"
}
```

Or for file-based agents:
```json
{
  "id": "my-coding-assistant",
  "path": "/absolute/path/to/agent.yml"
}
```

**Parameters:**
- `id` (string, required): Unique agent identifier
- `path` (string, optional): Absolute file path for file-based agents

### Responses

#### Success (200)
```json
{
  "switched": true,
  "id": "database-agent",
  "name": "Database Agent"
}
```

## Validate Agent Name
*Checks if an agent ID conflicts with existing agents.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agents/validate-name</code></p>

### Request Body
```json
{
  "id": "my-new-agent"
}
```

### Responses

#### Success (200) - Valid
```json
{
  "valid": true
}
```

**Success (200) - Conflict**
```json
{
  "valid": false,
  "conflict": "builtin",
  "message": "Agent id 'music-agent' already exists (builtin)"
}
```

## Uninstall Agent
*Removes an agent from the system. Custom agents are removed from registry; builtin agents can be reinstalled.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agents/uninstall</code></p>

### Request Body
```json
{
  "id": "my-custom-agent",
  "force": false
}
```

**Parameters:**
- `id` (string, required): Unique agent identifier to uninstall
- `force` (boolean, default: false): Force uninstall even if agent is currently active

### Responses

#### Success (200)
```json
{
  "uninstalled": true,
  "id": "my-custom-agent"
}
```

#### Error (400)
```json
{
  "ok": false,
  "issues": [
    {
      "code": "agent_validation_error",
      "message": "Cannot uninstall active agent without force flag",
      "severity": "error"
    }
  ]
}
```

## Create Custom Agent
*Creates a new custom agent from scratch via the UI/API.*

<p class="api-endpoint-header"><span class="api-method post">POST</span><code>/api/agents/custom/create</code></p>

### Request Body
```json
{
  "id": "coding-assistant",
  "name": "Coding Assistant",
  "description": "Specialized coding agent",
  "author": "John Doe",
  "tags": ["coding", "development"],
  "llm": {
    "provider": "openai",
    "model": "gpt-5",
    "apiKey": "$OPENAI_API_KEY"
  },
  "systemPrompt": "You are a specialized coding assistant..."
}
```

**Parameters:**
- `id` (string, required): Unique identifier (lowercase, numbers, and hyphens only)
- `name` (string, required): Display name for the agent
- `description` (string, required): One-line description
- `author` (string, optional): Author or organization
- `tags` (string[], optional): Tags for discovery and categorization
- `llm` (object, required):
  - `provider` (enum, required): LLM provider (`openai`, `anthropic`, `google`, `openrouter`, etc.)
  - `model` (string, required): Model name (e.g., `gpt-5`, `claude-sonnet-4-5-20250929`)
  - `apiKey` (string, optional): Environment variable reference (e.g., `$OPENAI_API_KEY`) or raw API key
- `systemPrompt` (string, required): System prompt for the agent

### Responses

#### Success (201)
```json
{
  "created": true,
  "id": "coding-assistant",
  "name": "Coding Assistant"
}
```

#### Error (400)
```json
{
  "ok": false,
  "issues": [
    {
      "code": "schema_validation",
      "message": "Agent ID must contain only lowercase letters, numbers, and hyphens",
      "path": ["id"],
      "severity": "error",
      "context": {"field": "id"}
    }
  ]
}
```

**Note:** If a raw API key is provided, it will be securely stored in the environment file and automatically converted to an environment variable reference.
