---
sidebar_position: 0
title: "Overview"
---

Dexto gives you two ways to build AI agents. Pick the approach that fits your needs.

## Two Ways to Build

### CLI & Configuration
**Build agents with YAML configuration files.** No code required.

```yaml
# my-agent.yml
systemPrompt: You are a helpful assistant.
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY
```

```bash
dexto --agent my-agent.yml
```

**Best for:** Quick prototypes, simple agents, config-driven workflows

→ [Get started with CLI & Configuration](./cli/index.md)

---

### Dexto Agent SDK
**Build agents programmatically with TypeScript.** Full control over behavior and integration.

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});

await agent.start();
const session = await agent.createSession();
const response = await agent.generate('Hello!', session.id);
```

**Best for:** Custom apps, production systems, complex integrations

→ [Get started with the Dexto Agent SDK](./sdk/index.md)

---

## Which Should I Choose?

| Use Case | Recommended |
|----------|-------------|
| Quick prototype or demo | CLI & Configuration |
| Simple task automation | CLI & Configuration |
| Multi-agent systems | CLI & Configuration |
| Custom web application | Dexto Agent SDK |
| Production backend service | Dexto Agent SDK |
| Embedding in existing app | Dexto Agent SDK |

## Need Help?

Join our [Discord community](https://discord.gg/GFzWFAAZcm) for questions and support.
