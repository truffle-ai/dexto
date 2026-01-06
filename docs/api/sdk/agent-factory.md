---
sidebar_position: 7
---

# AgentFactory API

The `AgentFactory` namespace provides static methods for agent creation, installation, and management. Use these functions to create agents from inline configs, install agents from the bundled registry, install custom agents, and manage installed agents.

```typescript
import { AgentFactory } from '@dexto/agent-management';
```

---

## createAgent

Creates a `DextoAgent` from an inline configuration object. Use this when you have a config from a database, API, or constructed programmatically and don't need a registry file.

```typescript
async function AgentFactory.createAgent(
  config: AgentConfig,
  options?: CreateAgentOptions
): Promise<DextoAgent>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `config` | `AgentConfig` | Agent configuration object |
| `options.agentId` | `string` | (Optional) Override agent ID (affects log/storage paths) |
| `options.isInteractiveCli` | `boolean` | (Optional) If true, disables console logging |

**Returns:** `Promise<DextoAgent>` - Agent instance (not started)

**Example:**
```typescript
import { AgentFactory } from '@dexto/agent-management';

// Create from inline config
const agent = await AgentFactory.createAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY
  },
  systemPrompt: 'You are a helpful assistant.'
});
await agent.start();

// With custom agent ID (affects log/storage paths)
const agent = await AgentFactory.createAgent(config, { agentId: 'my-custom-agent' });

// From database
const configFromDb = await db.getAgentConfig(userId);
const agent = await AgentFactory.createAgent(configFromDb, { agentId: `user-${userId}` });
await agent.start();
```

---

## listAgents

Lists all installed and available agents from the bundled registry.

```typescript
async function AgentFactory.listAgents(): Promise<{
  installed: AgentInfo[];
  available: AgentInfo[];
}>
```

**Returns:** Object with `installed` and `available` agent arrays

```typescript
interface AgentInfo {
  id: string;          // Unique identifier
  name: string;        // Display name
  description: string; // What the agent does
  author: string;      // Creator
  tags: string[];      // Categorization tags
  type: 'builtin' | 'custom';
}
```

**Example:**
```typescript
import { AgentFactory } from '@dexto/agent-management';

const { installed, available } = await AgentFactory.listAgents();

console.log('Installed agents:');
installed.forEach(agent => {
  console.log(`  - ${agent.name} (${agent.id})`);
});

console.log('\nAvailable to install:');
available.forEach(agent => {
  console.log(`  - ${agent.name}: ${agent.description}`);
});
```

---

## installAgent

Installs an agent from the bundled registry to the local agents directory (`~/.dexto/agents/`).

```typescript
async function AgentFactory.installAgent(
  agentId: string,
  options?: InstallOptions
): Promise<string>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `agentId` | `string` | Agent ID from bundled registry |
| `options.agentsDir` | `string` | (Optional) Custom agents directory |

**Returns:** `Promise<string>` - Path to installed agent's main config file

**Throws:** `DextoRuntimeError` if agent not found or installation fails

**Example:**
```typescript
import { AgentFactory } from '@dexto/agent-management';

// Install a bundled agent
const configPath = await AgentFactory.installAgent('coding-agent');
console.log(`Installed to: ${configPath}`);
```

### What Happens During Installation

1. Agent files are copied from bundled location to `~/.dexto/agents/{agentId}/`
2. Agent is added to the user's registry (`~/.dexto/agents/registry.json`)
3. User preferences are applied at runtime for the bundled coding-agent only

---

## installCustomAgent

Installs a custom agent from a local file or directory path.

```typescript
async function AgentFactory.installCustomAgent(
  agentId: string,
  sourcePath: string,
  metadata: {
    name?: string;
    description: string;
    author: string;
    tags: string[];
  },
  options?: InstallOptions
): Promise<string>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `agentId` | `string` | Unique ID for the custom agent |
| `sourcePath` | `string` | Absolute path to agent YAML file or directory |
| `metadata.name` | `string` | (Optional) Display name (defaults to agentId) |
| `metadata.description` | `string` | Description of what the agent does |
| `metadata.author` | `string` | Creator of the agent |
| `metadata.tags` | `string[]` | Categorization tags |
| `options.agentsDir` | `string` | (Optional) Custom agents directory |

**Returns:** `Promise<string>` - Path to installed agent's main config file

**Throws:**
- `DextoRuntimeError` if agent ID conflicts with bundled agent
- `DextoRuntimeError` if agent ID already exists
- `DextoRuntimeError` if source path doesn't exist

**Example:**
```typescript
import { AgentFactory } from '@dexto/agent-management';

// Install from a single YAML file
const configPath = await AgentFactory.installCustomAgent(
  'my-support-agent',
  '/path/to/support-agent.yml',
  {
    description: 'Custom support agent for our product',
    author: 'My Team',
    tags: ['support', 'custom']
  }
);

// Install from a directory (for agents with multiple files)
const configPath = await AgentFactory.installCustomAgent(
  'my-complex-agent',
  '/path/to/agent-directory/',
  {
    name: 'Complex Agent',
    description: 'Agent with knowledge files and multiple configs',
    author: 'My Team',
    tags: ['complex', 'custom']
  }
);
```

### Directory Structure for Multi-File Agents

When installing from a directory:

```
my-agent/
├── agent.yml           # Main config (required, or specify custom name)
├── knowledge/
│   ├── docs.md
│   └── faq.md
└── prompts/
    └── system.txt
```

---

## uninstallAgent

Removes an installed agent from disk and the user registry.

```typescript
async function AgentFactory.uninstallAgent(agentId: string): Promise<void>
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `agentId` | `string` | Agent ID to uninstall |

**Throws:** `DextoRuntimeError` if agent is not installed

**Example:**
```typescript
import { AgentFactory } from '@dexto/agent-management';

// Uninstall an agent
await AgentFactory.uninstallAgent('my-custom-agent');
console.log('Agent uninstalled');
```

### What Happens During Uninstallation

1. Agent directory is removed from `~/.dexto/agents/{agentId}/`
2. Agent entry is removed from user registry (`~/.dexto/agents/registry.json`)

:::caution
Uninstallation is permanent. All agent files including conversation history (if stored locally) will be deleted.
:::

---

## InstallOptions

Options for installation functions:

```typescript
interface InstallOptions {
  /** Directory where agents are stored (default: ~/.dexto/agents) */
  agentsDir?: string;
}
```

---

## Complete Example

```typescript
import { AgentFactory } from '@dexto/agent-management';
import { AgentManager } from '@dexto/agent-management';

async function setupAgents() {
  // List what's available
  const { installed, available } = await AgentFactory.listAgents();
  console.log(`${installed.length} installed, ${available.length} available`);

  // Install a bundled agent if not already installed
  if (!installed.some(a => a.id === 'coding-agent')) {
    await AgentFactory.installAgent('coding-agent');
    console.log('Installed coding-agent');
  }

  // Install a custom agent
  await AgentFactory.installCustomAgent(
    'team-agent',
    './my-agents/team-agent.yml',
    {
      description: 'Our team\'s custom agent',
      author: 'Engineering Team',
      tags: ['internal', 'custom']
    }
  );

  // Now use AgentManager to work with installed agents
  const manager = new AgentManager('~/.dexto/agents/registry.json');
  await manager.loadRegistry();

  const agent = await manager.loadAgent('team-agent');
  await agent.start();

  // ... use the agent ...

  await agent.stop();
}
```

---

## File Locations

| Resource | Path |
| :--- | :--- |
| Agents directory | `~/.dexto/agents/` |
| User registry | `~/.dexto/agents/registry.json` |
| Per-agent configs | `~/.dexto/agents/{agentId}/` |
| Bundled registry | Bundled with `@dexto/agent-management` package |

---

## See Also

- [AgentManager API](./agent-manager.md) - Registry-based agent lifecycle management
- [Config Utilities](./config-utilities.md) - Lower-level config loading functions
- [Agent Orchestration Tutorial](/docs/tutorials/sdk/orchestration) - Step-by-step guide
