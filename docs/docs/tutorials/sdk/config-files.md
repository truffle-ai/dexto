---
sidebar_position: 7
title: "Loading Agent Configs"
---

# Loading Agent Configs

You've been configuring agents inline with JavaScript objects. That's perfect for quick scripts, but applications with multiple agents need reusable, shareable configurations. This is where YAML config files come in—the same configs that power all of Dexto's built-in agents.

## What You'll Build

A pattern where:
1. Agent configurations live in YAML files (not in code)
2. Configs are loaded and validated at runtime
3. Multiple specialized agents use different config files
4. Configs get automatically enriched with agent-specific paths

By the end, you'll understand when to use inline configs vs. files, and how to organize configs for different agent types.

## Prerequisites

- Completed [Quick Start](./quick-start.md) tutorial
- Node.js 18+
- Basic understanding of YAML format

## Part I: From Inline to Config Files

### The Problems You'll Hit

Here's what you've been doing:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY
  },
  systemPrompt: 'You are a helpful assistant.'
});
```

This works for quick scripts, but you'll hit these problems:

**Problem 1: Config drift across your team**
Developer A runs with `model: 'gpt-4o-mini'`, Developer B runs with `model: 'gpt-4o'`. Same code, different behavior. Debugging becomes a nightmare because you can't easily see what config someone is using.

**Problem 2: Can't share agent configs**
Someone asks "what's your agent setup?" You have to send them your entire source code. Want to share just the agent config? You can't—it's buried in your application code.

**Problem 3: Changing models requires code changes**
Want to try Claude instead of GPT? You have to modify code, commit, and redeploy. Config should be external and swappable, not hardcoded.

**Problem 4: Hard to manage multiple agents**
Building a system with a coding agent, research agent, and support agent? Your code becomes a mess of nested objects. Each agent config lives in a different file, making them impossible to compare or organize.

### The Solution: YAML Config Files

Create `my-assistant.yml`:

```yaml
# Agent configuration
systemPrompt: |
  You are a helpful assistant specializing in technical documentation.
  Be concise, accurate, and provide code examples when relevant.

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
```

Now load it with the agent-management package:

```typescript
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

// Load config from file
const config = await loadAgentConfig('my-assistant.yml');

// Enrich with runtime paths (logs, storage, etc.)
const enrichedConfig = enrichAgentConfig(config, 'my-assistant.yml');

// Create agent with loaded config
const agent = new DextoAgent(enrichedConfig, 'my-assistant.yml');
await agent.start();
```

### Install Agent Management

```bash
npm install @dexto/agent-management
```

## Part II: Understanding Config Loading

### What `loadAgentConfig` Does

```typescript
import { loadAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('my-assistant.yml');
```

This function:
1. **Resolves paths** - Handles relative/absolute paths, searches standard locations
2. **Validates schema** - Ensures config matches the expected structure
3. **Expands environment variables** - Replaces `$OPENAI_API_KEY` with actual values
4. **Merges includes** - Supports config composition (advanced)

### What `enrichAgentConfig` Does

```typescript
import { enrichAgentConfig } from '@dexto/agent-management';

const enriched = enrichAgentConfig(config, 'my-assistant.yml');
```

This function automatically adds:
- **Log directory** - `~/.dexto/agents/my-assistant/logs/`
- **Storage paths** - `~/.dexto/agents/my-assistant/storage/`
- **Database paths** - `~/.dexto/agents/my-assistant/db/`
- **Blob storage** - `~/.dexto/agents/my-assistant/blobs/`

These paths are derived from the config file path, ensuring each agent gets isolated storage.

## Part III: Complete Working Example

Create `customer-support.yml`:

```yaml
systemPrompt: |
  You are a customer support assistant for TechCorp.

  Guidelines:
  - Always be polite and professional
  - Ask clarifying questions when needed
  - Escalate to human agents for refunds or account issues
  - Use the knowledge base tool to find accurate information

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.7

# Add MCP servers for capabilities
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "./knowledge-base"
```

Create `support-bot.ts`:

```typescript
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

async function startSupportBot() {
  try {
    // Load and enrich config
    const config = await loadAgentConfig('customer-support.yml');
    const enrichedConfig = enrichAgentConfig(config, 'customer-support.yml');

    // Create agent
    const agent = new DextoAgent(enrichedConfig, 'customer-support.yml');
    await agent.start();

    console.log('Customer support bot started');
    console.log('Config loaded from: customer-support.yml');
    console.log('Logs directory:', enrichedConfig.telemetry?.logDirectory);

    // Create session and test
    const session = await agent.createSession();
    const response = await agent.generate(
      'How do I reset my password?',
      { sessionId: session.id }
    );

    console.log('Response:', response.content);

    await agent.stop();
  } catch (error) {
    console.error('Failed to start agent:', error);
    process.exit(1);
  }
}

startSupportBot();
```

Run it:

```bash
export OPENAI_API_KEY=sk-...
npx tsx support-bot.ts
```

## Part IV: Managing Multiple Specialized Agents

You're building a platform with different agent types. Instead of one monolithic config, create specialized configs for each use case.

### Organize by Agent Type

```bash
agents/
├── coding-agent.yml      # Code generation & review
├── research-agent.yml    # Data gathering & analysis
├── support-agent.yml     # Customer support
└── creative-agent.yml    # Content writing
```

**coding-agent.yml:**
```yaml
systemPrompt: |
  You are an expert software engineer specializing in code generation,
  review, and debugging. Provide clear, efficient, well-documented code.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
  temperature: 0.3  # More deterministic for code

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```

**research-agent.yml:**
```yaml
systemPrompt: |
  You are a research analyst. Gather information from multiple sources,
  synthesize findings, and provide well-cited, comprehensive reports.

llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY
  temperature: 0.7

mcpServers:
  exa:
    type: http
    url: https://mcp.exa.ai/mcp
```

**support-agent.yml:**
```yaml
systemPrompt: |
  You are a friendly customer support assistant.
  Be empathetic, clear, and solution-focused.

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.8  # More conversational

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./kb"]
```

### Load Based on Use Case

Create `agent-loader.ts`:

```typescript
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

async function createAgent(agentType: string): Promise<DextoAgent> {
  const configPath = `agents/${agentType}.yml`;

  const config = await loadAgentConfig(configPath);
  const enriched = enrichAgentConfig(config, configPath);

  const agent = new DextoAgent(enriched, configPath);
  await agent.start();

  return agent;
}

// Usage: dynamically select agent
const userNeed = getUserRequest(); // "code", "research", "support", etc.

let agent: DextoAgent;
if (userNeed.includes('code') || userNeed.includes('function')) {
  agent = await createAgent('coding-agent');
} else if (userNeed.includes('research') || userNeed.includes('analyze')) {
  agent = await createAgent('research-agent');
} else {
  agent = await createAgent('support-agent');
}
```

### Benefits of This Pattern

**1. Clear separation of concerns**
Each agent's config is self-contained. Want to know what the coding agent does? Open `coding-agent.yml`.

**2. Easy to compare agents**
Configs side-by-side make it obvious how agents differ:
- Different system prompts for different personalities
- Different models for different tasks
- Different tools for different capabilities

**3. Simple to add new agent types**
Building a new agent? Create a new config file. No code changes needed.

**4. Team collaboration**
Product manager wants to change the support agent's tone? They can edit `support-agent.yml` directly without touching code.

## Part V: When to Use What

### Use Inline Configs When:
- **Quick scripts and demos** - Fast iteration, no file management
- **Dynamic configuration** - Config values computed at runtime
- **Testing** - Easier to modify configs in tests

```typescript
// Good for quick scripts
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
```

### Use Config Files When:
- **Multiple agents** - Reusable configs across your application
- **Team collaboration** - Easy to review and modify configs
- **Shared configs** - Need to distribute agent configs to others
- **Version control** - Track config changes separately from code

```typescript
// Good for reusable agents
const config = await loadAgentConfig('coding-agent.yml');
const enriched = enrichAgentConfig(config, 'coding-agent.yml');
const agent = new DextoAgent(enriched, 'coding-agent.yml');
```

### Hybrid Approach

You can also load a config and override specific values:

```typescript
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

// Load base config from file
let config = await loadAgentConfig('base-agent.yml');

// Override specific values based on runtime conditions
if (process.env.USE_ADVANCED_MODEL === 'true') {
  config.llm.model = 'gpt-4o';
}

// Apply enrichment and create agent
const enriched = enrichAgentConfig(config, 'base-agent.yml');
const agent = new DextoAgent(enriched, 'base-agent.yml');
```

## Key Takeaways

**Config Loading Pattern:**
```typescript
const config = await loadAgentConfig(path);    // Load & validate
const enriched = enrichAgentConfig(config, path);  // Add runtime paths
const agent = new DextoAgent(enriched, path);      // Create agent
```

**Why This Matters:**
- **loadAgentConfig** - Validates, resolves paths, expands env vars
- **enrichAgentConfig** - Adds per-agent storage/log paths automatically
- **Both together** - Complete config management

**Key Benefits:**
- Configs version-controlled separately from code
- Easy to share, review, and audit configurations
- Organize multiple agent types cleanly
- Automatic path management for logs and storage

## What's Next?

You've learned how to move from inline configs to file-based configs. But what if you're building a service that manages multiple agents? What if users can choose from different specialized agents?

That's where programmatic agent management comes in.

**Continue to:** [Agent Orchestration](./orchestration.md)
