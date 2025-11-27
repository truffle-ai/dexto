---
sidebar_position: 8
title: "Agent Orchestration"
---

# Agent Orchestration

You've learned how to build and configure individual agents. But what if you need multiple specialized agents for different tasks? Or want to organize different agent configurations in one place?

This tutorial teaches you how to use `AgentManager` to work with multiple agents from a simple registry file.

## What You'll Learn

By the end of this tutorial, you'll know how to:
1. Create a registry file to organize your agents
2. List and discover agents from the registry
3. Create and manage multiple agent instances
4. Filter and select agents dynamically

## Prerequisites

- Completed [Loading Agent Configs](./config-files.md) tutorial
- Basic TypeScript knowledge
- Node.js 18+

## The Pattern: Registry + Manager

When managing multiple agents, you need:
- **A registry** - JSON file listing your agents and their config paths
- **A manager** - Loads the registry and creates agent instances

```typescript
const manager = new AgentManager('./agents/registry.json');
const agent = await manager.createAgent('coding-agent');
```

Simple as that!

## Setting Up Your Project

### 1. Create Your Agent Configs

Create an `agents/` directory with your agent YAML files:

```bash
mkdir agents
```

Create `agents/coding-agent.yml`:

```yaml
systemPrompt: |
  You are an expert coding assistant. Help users write clean, efficient code.
  Provide explanations and best practices.

llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY
```

Create `agents/support-agent.yml`:

```yaml
systemPrompt: |
  You are a friendly customer support assistant. Help users resolve issues
  with empathy and clear guidance.

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
```

### 2. Create Your Registry File

Create `agents/registry.json`:

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

**Registry format:**
- `id` - Unique identifier for the agent
- `name` - Human-readable name
- `description` - What this agent does
- `configPath` - Path to YAML config (relative to registry.json)
- `tags` - Optional tags for categorization
- `author` - Optional author name

### 3. Your Project Structure

```
my-project/
  agents/
    registry.json
    coding-agent.yml
    support-agent.yml
  src/
    index.ts
  package.json
```

## Using AgentManager

### Install Dependencies

```bash
npm install @dexto/core @dexto/agent-management
```

### Basic Usage

Create `src/index.ts`:

```typescript
import { AgentManager } from '@dexto/agent-management';

async function main() {
  // Create manager pointing to your registry
  const manager = new AgentManager('./agents/registry.json');

  // List available agents
  const agents = manager.listAgents();
  console.log('Available agents:');
  agents.forEach(a => {
    console.log(`  - ${a.id}: ${a.name}`);
    console.log(`    ${a.description}`);
  });

  // Create an agent
  const codingAgent = await manager.createAgent('coding-agent');
  await codingAgent.start();

  // Use it
  const session = await codingAgent.createSession();
  const response = await codingAgent.generate(
    'Write a function to reverse a string',
    { sessionId: session.id }
  );

  console.log(response.content);

  // Cleanup
  await codingAgent.stop();
}

main();
```

Run it:

```bash
export OPENAI_API_KEY=sk-...
npx tsx src/index.ts
```

**Output:**
```
Available agents:
  - coding-agent: Coding Assistant
    Expert coding assistant for development tasks
  - support-agent: Support Assistant
    Friendly customer support agent

[Response from coding agent...]
```

## Managing Multiple Specialized Agents

A common pattern is pre-loading specialized agents for different tasks:

```typescript
import { AgentManager } from '@dexto/agent-management';

async function main() {
  const manager = new AgentManager('./agents/registry.json');

  // Create all agents upfront
  const [codingAgent, supportAgent, researchAgent] = await Promise.all([
    manager.createAgent('coding-agent'),
    manager.createAgent('support-agent'),
    manager.createAgent('research-agent'),
  ]);

  // Start them all
  await Promise.all([
    codingAgent.start(),
    supportAgent.start(),
    researchAgent.start(),
  ]);

  // Route requests to the right agent
  async function handleRequest(type: string, message: string) {
    let agent;

    switch (type) {
      case 'code':
        agent = codingAgent;
        break;
      case 'support':
        agent = supportAgent;
        break;
      case 'research':
        agent = researchAgent;
        break;
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }

    const session = await agent.createSession();
    return await agent.generate(message, { sessionId: session.id });
  }

  // Use them
  const codeResponse = await handleRequest('code', 'Write a binary search');
  const helpResponse = await handleRequest('support', 'How do I reset my password?');

  console.log('Code:', codeResponse.content);
  console.log('Support:', helpResponse.content);

  // Cleanup
  await Promise.all([
    codingAgent.stop(),
    supportAgent.stop(),
    researchAgent.stop(),
  ]);
}

main();
```

## Dynamic Agent Selection

You can filter agents by tags or search by description:

```typescript
import { AgentManager } from '@dexto/agent-management';

const manager = new AgentManager('./agents/registry.json');
const agents = manager.listAgents();

// Find coding agents
const codingAgents = agents.filter(a => a.tags?.includes('coding'));
console.log('Coding agents:', codingAgents.map(a => a.id));

// Search by description
const supportAgents = agents.filter(a =>
  a.description.toLowerCase().includes('support')
);
console.log('Support agents:', supportAgents.map(a => a.id));

// Create the first match
if (codingAgents.length > 0) {
  const agent = await manager.createAgent(codingAgents[0].id);
  await agent.start();
}
```

## Key Concepts

**AgentManager provides:**
- `new AgentManager(registryPath)` - Point to your registry.json
- `listAgents()` - Get all agents from registry (sync, after first load)
- `createAgent(id)` - Create a DextoAgent instance from registry
- `hasAgent(id)` - Check if an agent exists

**Typical workflow:**
1. Create your agent YAML configs
2. Create a registry.json listing your agents
3. Create an `AgentManager` pointing to the registry
4. Use `listAgents()` to discover available agents
5. Use `createAgent(id)` to create instances as needed
6. Keep agent instances running for reuse in your application

**When to use this:**
- Managing multiple specialized agents in your application
- Organizing project-specific agent configurations
- Dynamically selecting agents based on task type
- Need a simple way to list and load agents

**Registry files can be:**
- Project-local (`./agents/registry.json`)
- User-specific (`~/.config/my-app/agents.json`)
- Environment-specific (`./config/${ENV}/agents.json`)

## What's Next?

You've completed the SDK tutorial path! You now understand:
- ✅ Creating and configuring agents
- ✅ Managing sessions and conversations
- ✅ Serving multiple users
- ✅ Adding tools and capabilities
- ✅ Handling events for responsive UIs
- ✅ Loading configs from YAML files
- ✅ Managing multiple agents with registries

**Continue learning:**
- **[API Reference](/api/sdk/dexto-agent)** - Complete API documentation
- **[MCP Guide](/mcp/overview)** - Deep dive into tools and capabilities
- **[CLI Examples](/tutorials/cli/examples/multi-agent-systems)** - Build advanced agent systems

You're ready to build production AI agent applications with Dexto!
