---
sidebar_position: 6
---

# Config Utilities

Utilities for loading and enriching agent configurations from YAML files. These functions are the building blocks for programmatic agent management.

```typescript
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
```

---

## loadAgentConfig

Loads and processes an agent configuration from a YAML file. Handles file reading, YAML parsing, and template variable expansion.

```typescript
async function loadAgentConfig(
  configPath: string,
  logger?: IDextoLogger
): Promise<AgentConfig>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `configPath` | `string` | Path to the YAML config file (absolute or relative) |
| `logger` | `IDextoLogger` | (Optional) Logger instance for debug output |

**Returns:** `Promise<AgentConfig>` - Parsed configuration object

**Throws:**
- `ConfigError` with `FILE_NOT_FOUND` if file doesn't exist
- `ConfigError` with `FILE_READ_ERROR` if file read fails
- `ConfigError` with `PARSE_ERROR` if YAML is invalid

### What It Does

1. **Reads the YAML file** from disk
2. **Parses YAML** into a JavaScript object
3. **Expands template variables** like `${{dexto.agent_dir}}`
4. **Expands environment variables** like `$OPENAI_API_KEY`

### Example

```typescript
import { loadAgentConfig } from '@dexto/agent-management';

// Load a config file
const config = await loadAgentConfig('./agents/my-agent.yml');

console.log(config.llm.provider); // 'openai'
console.log(config.llm.model);    // 'gpt-4o'
```

### Template Variables

Config files can use template variables that are expanded at load time:

```yaml
# my-agent.yml
systemPrompt:
  contributors:
    - id: knowledge
      type: file
      files:
        - ${{dexto.agent_dir}}/knowledge/docs.md
```

| Variable | Expands To |
| :--- | :--- |
| `${{dexto.agent_dir}}` | Directory containing the config file |

### Environment Variables

Environment variables are expanded during schema validation:

```yaml
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY  # Expanded from environment
```

---

## enrichAgentConfig

Enriches a loaded configuration with per-agent runtime paths for logs, database, and blob storage. This function should be called after `loadAgentConfig` and before creating a `DextoAgent`.

```typescript
function enrichAgentConfig(
  config: AgentConfig,
  configPath?: string,
  isInteractiveCli?: boolean
): AgentConfig
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `config` | `AgentConfig` | Configuration from `loadAgentConfig` |
| `configPath` | `string` | (Optional) Path to config file (used for agent ID derivation) |
| `isInteractiveCli` | `boolean` | (Optional) If true, disables console logging (default: false) |

**Returns:** `AgentConfig` - Enriched configuration with explicit paths

### What It Adds

Each agent gets isolated paths based on its ID:

| Resource | Path |
| :--- | :--- |
| Logs | `~/.dexto/agents/{agentId}/logs/{agentId}.log` |
| Database | `~/.dexto/agents/{agentId}/db/{agentId}.db` |
| Blob Storage | `~/.dexto/agents/{agentId}/blobs/` |

### Agent ID Derivation

The agent ID is derived in priority order:
1. `agentCard.name` from config (sanitized)
2. Config filename (without extension)
3. Fallback: `coding-agent`

### Example

```typescript
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import { DextoAgent } from '@dexto/core';

// Load raw config
const config = await loadAgentConfig('./agents/coding-agent.yml');

// Enrich with runtime paths
const enrichedConfig = enrichAgentConfig(config, './agents/coding-agent.yml');

// Create agent with enriched config
const agent = new DextoAgent(enrichedConfig, './agents/coding-agent.yml');
await agent.start();
```

### Default Storage Configuration

If no storage is specified in the config, enrichment adds:

```typescript
{
  storage: {
    cache: { type: 'in-memory' },
    database: { type: 'sqlite', path: '~/.dexto/agents/{agentId}/db/{agentId}.db' },
    blob: { type: 'local', storePath: '~/.dexto/agents/{agentId}/blobs/' }
  }
}
```

---

## Complete Usage Pattern

```typescript
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import { DextoAgent } from '@dexto/core';

async function createAgentFromConfig(configPath: string): Promise<DextoAgent> {
  // 1. Load the YAML config
  const config = await loadAgentConfig(configPath);

  // 2. Enrich with runtime paths
  const enrichedConfig = enrichAgentConfig(config, configPath);

  // 3. Create and start the agent
  const agent = new DextoAgent(enrichedConfig, configPath);
  await agent.start();

  return agent;
}

// Usage
const agent = await createAgentFromConfig('./agents/my-agent.yml');
const session = await agent.createSession();
const response = await agent.generate('Hello!', session.id);
```

---

## Error Handling

```typescript
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

try {
  const config = await loadAgentConfig('./agents/my-agent.yml');
  const enriched = enrichAgentConfig(config, './agents/my-agent.yml');
} catch (error) {
  if (error.code === 'FILE_NOT_FOUND') {
    console.error('Config file not found:', error.path);
  } else if (error.code === 'PARSE_ERROR') {
    console.error('Invalid YAML:', error.message);
  }
}
```

---

## See Also

- [AgentManager API](./agent-manager.md) - Higher-level registry-based management
- [AgentFactory API](./agent-factory.md) - Agent installation functions
- [Loading Agent Configs Tutorial](/docs/tutorials/sdk/config-files) - Step-by-step guide
