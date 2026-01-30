---
sidebar_position: 5
---

# AgentManager API

The `AgentManager` class provides registry-based agent lifecycle management. It loads agent configurations from a registry file and creates agent instances programmatically.

```typescript
import { AgentManager } from '@dexto/agent-management';
```

:::note When to use AgentManager
**`AgentManager`** - Registry-based. Use when you have a `registry.json` with multiple predefined agents.
:::

---

## Constructor

### `constructor`

Creates a new AgentManager instance pointing to a registry file.

```typescript
constructor(registryPath: string)
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `registryPath` | `string` | Path to registry.json file (absolute or relative) |

**Example:**
```typescript
// Project-local registry
const manager = new AgentManager('./agents/registry.json');

// Absolute path
const manager = new AgentManager('/path/to/registry.json');
```

---

## Methods

### `loadRegistry`

Loads the registry from file. Must be called before using sync methods like `listAgents()` or `hasAgent()`.

```typescript
async loadRegistry(): Promise<Registry>
```

**Returns:** `Promise<Registry>` - The loaded registry object

**Example:**
```typescript
const manager = new AgentManager('./registry.json');
await manager.loadRegistry();

// Now sync methods work
const agents = manager.listAgents();
```

:::note
`loadAgent()` automatically calls `loadRegistry()` if not already loaded.
:::

---

### `listAgents`

Returns metadata for all agents in the registry.

```typescript
listAgents(): AgentMetadata[]
```

**Returns:** `AgentMetadata[]` - Array of agent metadata objects

```typescript
interface AgentMetadata {
  id: string;          // Unique identifier
  name: string;        // Display name
  description: string; // What the agent does
  author?: string;     // Creator
  tags?: string[];     // Categorization tags
}
```

**Example:**
```typescript
const manager = new AgentManager('./registry.json');
await manager.loadRegistry();

const agents = manager.listAgents();
console.log(agents);
// [
//   { id: 'coding-agent', name: 'Coding Assistant', description: '...', tags: ['coding'] },
//   { id: 'support-agent', name: 'Support Assistant', description: '...', tags: ['support'] }
// ]

// Filter by tag
const codingAgents = agents.filter(a => a.tags?.includes('coding'));
```

---

### `hasAgent`

Checks if an agent exists in the registry.

```typescript
hasAgent(id: string): boolean
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Agent ID to check |

**Returns:** `boolean` - True if agent exists

**Example:**
```typescript
const manager = new AgentManager('./registry.json');
await manager.loadRegistry();

if (manager.hasAgent('coding-agent')) {
  const agent = await manager.loadAgent('coding-agent');
}
```

---

### `loadAgent`

Loads a `DextoAgent` instance from the registry. Loads the agent's YAML config, enriches it with runtime paths, and returns an unstarted agent.

```typescript
async loadAgent(id: string): Promise<DextoAgent>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Agent ID from registry |

**Returns:** `Promise<DextoAgent>` - Agent instance (not started)

**Throws:**
- `DextoRuntimeError` if agent not found or config loading fails
- `DextoValidationError` if agent config validation fails

**Example:**
```typescript
const manager = new AgentManager('./registry.json');
const agent = await manager.loadAgent('coding-agent');
await agent.start();

// Use the agent
const session = await agent.createSession();
const response = await agent.generate('Write a function to reverse a string', session.id);

console.log(response.content);
await agent.stop();
```

---

## Registry Format

The registry file is a JSON file that describes available agents:

```json
{
  "agents": [
    {
      "id": "coding-agent",
      "name": "Coding Assistant",
      "description": "Expert coding assistant for development tasks",
      "configPath": "./coding-agent.yml",
      "author": "Your Team",
      "tags": ["coding", "development"]
    },
    {
      "id": "support-agent",
      "name": "Support Assistant",
      "description": "Friendly customer support agent",
      "configPath": "./support-agent.yml",
      "tags": ["support", "customer-service"]
    }
  ]
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Yes | Unique identifier (used in `loadAgent()`) |
| `name` | `string` | Yes | Human-readable display name |
| `description` | `string` | Yes | What this agent does |
| `configPath` | `string` | Yes | Path to YAML config (relative to registry.json) |
| `author` | `string` | No | Creator of the agent |
| `tags` | `string[]` | No | Categorization tags |

---

## Complete Example

```typescript
import { AgentManager } from '@dexto/agent-management';

async function main() {
  // Initialize manager
  const manager = new AgentManager('./agents/registry.json');
  await manager.loadRegistry();

  // List available agents
  console.log('Available agents:');
  for (const agent of manager.listAgents()) {
    console.log(`  - ${agent.name} (${agent.id}): ${agent.description}`);
  }

  // Create and use an agent
  if (manager.hasAgent('coding-agent')) {
    const agent = await manager.loadAgent('coding-agent');
    await agent.start();

    const session = await agent.createSession();
    const response = await agent.generate('Hello!', session.id);
    console.log(response.content);

    await agent.stop();
  }
}

main();
```

---

## Error Handling

```typescript
import { AgentManager } from '@dexto/agent-management';

try {
  const manager = new AgentManager('./registry.json');
  const agent = await manager.loadAgent('non-existent-agent');
} catch (error) {
  if (error.code === 'AGENT_NOT_FOUND') {
    console.log('Agent not found in registry');
  } else if (error.name === 'DextoValidationError') {
    console.log('Agent config validation failed:', error.issues);
  }
}
```

---

## See Also

- [Config Utilities](./config-utilities.md) - Lower-level config loading functions
- [AgentFactory API](./agent-factory.md) - Agent installation and management
- [Agent Orchestration Tutorial](/docs/tutorials/sdk/orchestration) - Step-by-step guide
