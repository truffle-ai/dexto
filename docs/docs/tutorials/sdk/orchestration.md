---
sidebar_position: 8
title: "Agent Orchestration"
---

# Agent Orchestration

You've learned to load agent configs from YAML files. But what if you're building a platform with many specialized agents? Users might choose between a coding agent, research agent, or support agent—and you need a way to list, discover, and create them dynamically.

`AgentManager` solves this with a simple registry file.

## The Problem

With multiple agents, you end up hardcoding paths everywhere:

```typescript
// You have to know and hardcode every config path
const codingConfig = await loadAgentConfig('agents/coding-agent.yml');
const supportConfig = await loadAgentConfig('agents/support-agent.yml');

// Want to list available agents? Manual work
const available = ['coding-agent', 'support-agent', 'research-agent'];
```

No metadata, no discovery, no organization.

## The Solution: Registry + Manager

Create a registry file that describes your agents. Then use `AgentManager` to work with them.

**Step 1:** Create your agent configs in `agents/`:

```yaml
# agents/coding-agent.yml
systemPrompt: You are an expert coding assistant.
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY
```

**Step 2:** Create `agents/registry.json`:

```json
{
  "agents": [
    {
      "id": "coding-agent",
      "name": "Coding Assistant",
      "description": "Expert coding assistant for development tasks",
      "configPath": "./coding-agent.yml",
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

**Step 3:** Use `AgentManager`:

```typescript
import { AgentManager } from '@dexto/agent-management';

const manager = new AgentManager('./agents/registry.json');
await manager.loadRegistry();

// Discover what's available
const agents = manager.listAgents();
console.log(agents);
// [
//   { id: 'coding-agent', name: 'Coding Assistant', description: '...', tags: [...] },
//   { id: 'support-agent', name: 'Support Assistant', description: '...', tags: [...] }
// ]

// Create an agent by ID
const agent = await manager.createAgent('coding-agent');
await agent.start();

const session = await agent.createSession();
const response = await agent.generate('Write a function to reverse a string', {
  sessionId: session.id
});

console.log(response.content);
```

**That's it.** Your agents are now organized, discoverable, and easy to manage.

## Registry Format

Each agent entry needs:
- `id` - Unique identifier (used in `createAgent('id')`)
- `name` - Human-readable display name
- `description` - What this agent does
- `configPath` - Path to YAML config (relative to registry.json)

Optional fields:
- `tags` - For filtering/categorization
- `author` - Who created the agent

## The AgentManager API

```typescript
const manager = new AgentManager('./registry.json');

// Load the registry first (required)
await manager.loadRegistry();

// List all agents with metadata
const agents = manager.listAgents();

// Check if an agent exists
if (manager.hasAgent('coding-agent')) {
  // Create a DextoAgent instance
  const agent = await manager.createAgent('coding-agent');
  await agent.start();
}
```

## Routing Requests to Different Agents

A common pattern: pre-load your agents and route requests:

```typescript
const manager = new AgentManager('./agents/registry.json');

// Create agents upfront
const agents = {
  code: await manager.createAgent('coding-agent'),
  support: await manager.createAgent('support-agent'),
};

// Start them all
await Promise.all(Object.values(agents).map(a => a.start()));

// Route by request type
async function handleRequest(type: 'code' | 'support', message: string) {
  const agent = agents[type];
  const session = await agent.createSession();
  return agent.generate(message, { sessionId: session.id });
}

// Use it
const response = await handleRequest('code', 'Write a binary search');
```

## Filtering Agents

Use the metadata to find the right agent:

```typescript
await manager.loadRegistry();
const agents = manager.listAgents();

// Find by tag
const codingAgents = agents.filter(a => a.tags?.includes('coding'));

// Find by description
const supportAgents = agents.filter(a =>
  a.description.toLowerCase().includes('support')
);

// Create the first match
if (codingAgents.length > 0) {
  const agent = await manager.createAgent(codingAgents[0].id);
}
```

## When to Use AgentManager

**Use `loadAgentConfig` directly when:**
- You have 1-3 agents
- You know exactly which configs to load
- Simple applications

**Use `AgentManager` when:**
- Many agents that users can choose from
- You need to list/discover available agents
- Building agent marketplaces or platforms
- Dynamic agent selection based on metadata

## What's Next?

You've completed the SDK tutorials! You now know how to:
- ✅ Create and configure agents
- ✅ Manage sessions and conversations
- ✅ Serve multiple users
- ✅ Add tools and capabilities
- ✅ Handle events for responsive UIs
- ✅ Load configs from YAML files
- ✅ Orchestrate multiple agents with registries

**Continue learning:**
- **[SDK Guide](/docs/guides/dexto-sdk)** - Complete SDK documentation
- **[MCP Guide](/docs/mcp/overview)** - Deep dive into tools and capabilities
- **[CLI Examples](/docs/tutorials/cli/examples/multi-agent-systems)** - Build advanced agent systems
