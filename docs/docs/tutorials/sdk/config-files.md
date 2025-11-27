---
sidebar_position: 7
title: "Loading Agent Configs"
---

# Loading Agent Configs

You've been configuring agents inline with JavaScript objects. That works for quick scripts, but as your project grows, configs buried in code become hard to share, review, and manage across a team.

YAML config files solve this—the same approach Dexto's built-in agents use.

## The Problem

Here's what you've been doing:

```typescript
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY
  },
  systemPrompt: 'You are a helpful assistant.'
});
```

This gets messy fast. Config drift between team members, no easy way to share agent setups, and switching models means changing code.

## The Solution: YAML Config Files

Move your config to a file. Create `my-agent.yml`:

```yaml
systemPrompt: |
  You are a helpful assistant specializing in technical documentation.
  Be concise and provide code examples when relevant.

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
```

Now load it:

```typescript
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('my-agent.yml');
const enriched = enrichAgentConfig(config, 'my-agent.yml');

const agent = new DextoAgent(enriched, 'my-agent.yml');
await agent.start();
```

**That's it.** Your config is now external, shareable, and version-controlled separately from your code.

```bash
npm install @dexto/agent-management
```

## What These Functions Do

**`loadAgentConfig(path)`** reads your YAML and:
- Validates the schema
- Expands environment variables (`$OPENAI_API_KEY` → actual value)
- Resolves relative paths

**`enrichAgentConfig(config, path)`** adds runtime paths:
- Logs: `~/.dexto/agents/my-agent/logs/`
- Storage: `~/.dexto/agents/my-agent/storage/`
- Database: `~/.dexto/agents/my-agent/db/`

Each agent gets isolated storage automatically, derived from the config filename.

## Organizing Multiple Agents

Building a system with different agent types? Organize them in a folder:

```text
agents/
├── coding-agent.yml
├── research-agent.yml
└── support-agent.yml
```

Each config tailored to its task:

```yaml
# coding-agent.yml - Low temperature for deterministic code
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
  temperature: 0.3

systemPrompt: You are an expert software engineer.
```

```yaml
# support-agent.yml - Higher temperature for conversational tone
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
  temperature: 0.8

systemPrompt: You are a friendly customer support assistant.
```

Load whichever you need:

```typescript
async function createAgent(type: string): Promise<DextoAgent> {
  const path = `agents/${type}.yml`;
  const config = await loadAgentConfig(path);
  const enriched = enrichAgentConfig(config, path);

  const agent = new DextoAgent(enriched, path);
  await agent.start();
  return agent;
}

// Pick the right agent for the task
const agent = await createAgent('coding-agent');
```

## When to Use What

**Use inline configs when:**
- Quick scripts and demos
- Config values computed at runtime
- Writing tests

**Use config files when:**
- Multiple agents in your application
- Team needs to review/modify configs
- You want version-controlled agent settings

**Hybrid approach**—load a file, override at runtime:

```typescript
const config = await loadAgentConfig('base-agent.yml');
config.llm.model = process.env.USE_ADVANCED ? 'gpt-4o' : 'gpt-4o-mini';

const enriched = enrichAgentConfig(config, 'base-agent.yml');
const agent = new DextoAgent(enriched, 'base-agent.yml');
```

## What's Next?

Config files work great for a handful of agents. But what if you're building a platform where users choose from many specialized agents? You need a way to list, discover, and manage them programmatically.

**Continue to:** [Agent Orchestration](./orchestration.md)
