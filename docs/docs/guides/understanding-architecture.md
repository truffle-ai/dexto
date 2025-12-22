---
sidebar_position: 1
title: Understanding Dexto's Architecture
description: Learn how Dexto's layers work together - from core to your application
---

# Understanding Dexto's Architecture

Dexto is built in layers, each with a specific purpose. Understanding these layers will help you choose the right approach for your project.

## The 5 Layer Cake

Dexto has **five distinct layers**:

- **Layer 1: Agent Harness** (`@dexto/core`) - Orchestration system, provides `DextoAgent` class and registries
- **Layer 2: Providers** - Packages that add capabilities (tools, storage, etc.)
- **Layer 3: Images** - Curated bundles of providers for specific contexts
- **Layer 4: Agent Config** - YAML files that configure agent instances
- **Layer 5: Your Application** - The application code you build (bot, CLI, web app, etc.)

```
┌─────────────────────────────────────────────────┐
│  Layer 5: Your Application (Discord Bot)       │  ← What you build
├─────────────────────────────────────────────────┤
│  Layer 4: Agent Config (agent.yml)             │  ← Instance settings
├─────────────────────────────────────────────────┤
│  Layer 3: Image (@dexto/image-local) [Optional]│  ← Curated bundle
├─────────────────────────────────────────────────┤
│  Layer 2: Providers (filesystem, process, etc.)│  ← Capabilities
├─────────────────────────────────────────────────┤
│  Layer 1: Agent Harness (@dexto/core)          │  ← Orchestration
└─────────────────────────────────────────────────┘
```

## Layer 1: Agent Harness (Core)

The core provides:
- The `DextoAgent` class - orchestrates everything
- Interfaces for providers to implement
- Registries where providers register themselves
- Validation schemas and type definitions

**What it doesn't provide:** Any implementations. It's pure orchestration and contracts.

```typescript
import { DextoAgent, customToolRegistry } from '@dexto/core';
```

**When to use:** Always (either directly or through image re-exports), when building custom providers, or when you want maximum control.

## Layer 2: Providers - Adding Functionality

**What they are:** npm packages that add specific capabilities to your agent.

Each provider:
- Implements a core interface
- Registers itself when imported
- Provides focused functionality

**Official Providers:**
- `@dexto/tools-filesystem` - Read, write, edit files
- `@dexto/tools-process` - Execute shell commands
- More coming soon!

**Example Provider:**
```typescript
// Simplified view of a provider
export const fileSystemToolsProvider = {
  type: 'filesystem-tools',
  tools: ['read_file', 'write_file', 'edit_file', ...]
};

// When you import this package, it auto-registers
import '@dexto/tools-filesystem';
// Now filesystem tools are available to agents!
```

**When to create custom providers:**
- Adding API integrations (Salesforce, Slack, etc.)
- Custom storage backends
- Company-specific tools

:::info
Providers are independent packages. Install only what you need to keep your application lightweight.
:::

## Layer 3: Images - Pre-Built Collections (Optional!)

**What they are:** Curated bundles of providers for specific use cases.

Think of images like Linux distributions:
- **Ubuntu** is great for desktops (many packages, easy to use)
- **Alpine** is perfect for containers (minimal, efficient)
- **Your custom distro** fits your organization

Similarly:
- **@dexto/image-local** is perfect for development (filesystem + process tools)
- **@dexto/image-cloud** (future) for production (S3 + Postgres, no filesystem)
- **@dexto/image-browser** (future) for web apps (IndexedDB, no server tools)

**What an image does:**
```typescript
// Inside @dexto/image-local
import { fileSystemToolsProvider } from '@dexto/tools-filesystem';
import { processToolsProvider } from '@dexto/tools-process';
import { customToolRegistry } from '@dexto/core';

// Auto-registers providers when image is imported
customToolRegistry.register(fileSystemToolsProvider);
customToolRegistry.register(processToolsProvider);

// Also re-exports core for convenience
export * from '@dexto/core';
```

**When to use images:**
- Quick start (use `@dexto/image-local`)
- Standard scenarios (local dev, cloud deployment)
- You want batteries included

**When to skip images:**
- Very specific requirements
- Minimal installations
- You want complete control

:::tip Images are Completely Optional
You can build directly on core without any image. Images are just convenient bundles!
:::

## Layer 4: Agent Config - Instance Settings

**What it is:** A YAML file that configures a specific agent instance.

Your config specifies:
- Which LLM to use (Claude, GPT-4, etc.)
- Which tools to enable
- System prompt and behavior
- Optionally, which image you expect

**Example Config:**
```yaml
# coding-agent.yml
image: '@dexto/image-local'  # Optional - documents expected providers

systemPrompt: "You are a coding assistant"

llm:
  provider: anthropic
  model: claude-sonnet-4

customTools:
  - type: filesystem-tools
    allowedPaths: ["."]
  - type: process-tools
    securityLevel: moderate
```

**Important:** The config is pure data. It can't load images or execute code. Your application handles that.

**Validation:** If your config declares custom tools (like `filesystem-tools`), the providers MUST be registered before the agent starts. The agent will fail immediately with a clear error if required providers are missing. This fail-fast behavior prevents silent degradation where agents load without their required capabilities.

:::tip Config Reusability
A single config file can be loaded and then enriched with runtime data (like `userId`, `authContext`) to create multiple agent instances. For example, in a multi-tenant app, you might load one base config and then add tenant-specific data before creating each agent:

```typescript
const baseConfig = await loadAgentConfig('./base-agent.yml');

// Tenant A
const tenantAConfig = { ...baseConfig, /* add tenant A data */ };
const agentA = new DextoAgent(tenantAConfig, configPath);

// Tenant B
const tenantBConfig = { ...baseConfig, /* add tenant B data */ };
const agentB = new DextoAgent(tenantBConfig, configPath);
```

For completely different agent purposes (e.g., coding vs. writing), create separate config files.
:::

## Layer 5: Your Application - Tying It Together

**This is what you build!** Your application:
- Loads images (if using them)
- Reads agent configs
- Creates DextoAgent instances
- Provides user interface (CLI, web, bot, API)

## The Four Usage Patterns

Choose the pattern that fits your needs:

### Pattern 1: Static Import (Production Apps)

**Best for:** Type-safe production applications

**Example:** Building a Discord bot that always runs on a server with known requirements.

```typescript
import '@dexto/image-local';  // Load providers
import { DextoAgent, loadAgentConfig } from '@dexto/core';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
```

**Pros:** Full type safety, build-time validation
**Cons:** Can't switch images at runtime

**Use when:** Building a specific application where you control the deployment environment.

---

### Pattern 2: Dynamic Loading (Infrastructure/Platforms)

**Best for:** CLI tools, multi-tenant SaaS, containerized deployments

**Example:** Multi-tenant SaaS where different customers need different providers, or Docker containers where image is set via environment variables.

```typescript
import { DextoAgent, loadAgentConfig } from '@dexto/core';

const config = await loadAgentConfig('./agent.yml');

// Load image with priority: CLI flag > config > env > default
const imageName =
  cliFlag ||
  config.image ||
  process.env.DEXTO_IMAGE ||
  '@dexto/image-local'; // Default for convenience

await import(imageName);

const agent = new DextoAgent(config, './agent.yml');
```

**Pros:** Runtime flexibility, support multiple images
**Cons:** Errors caught at runtime, not build time

**Use when:** Building infrastructure that needs to support multiple deployment scenarios or tenant configurations.

---

### Pattern 3: Import from Image (Quick Start)

**Best for:** Prototypes, tutorials, learning

**Example:** Hackathon project where you want to start building features immediately without infrastructure setup.

```typescript
import { DextoAgent, loadAgentConfig } from '@dexto/image-local';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
```

**Pros:** Simplest code, batteries included
**Cons:** Less separation between layers

**Use when:** Learning Dexto, quick prototypes, tutorials, or hackathons.

---

### Pattern 4: No Image (Advanced)

**Best for:** Maximum control, minimal footprint

**Example:** Security-critical system where you need to guarantee zero filesystem access and only use specific audited providers.

```typescript
import { DextoAgent, customToolRegistry } from '@dexto/core';

// Manually register only what you need
import { myCustomProvider } from './my-provider';
customToolRegistry.register(myCustomProvider);

const agent = new DextoAgent(config, './agent.yml');
```

**Pros:** Complete control, minimal dependencies, enhanced security
**Cons:** More manual setup, need to understand providers

**Use when:** Security-critical systems, embedded devices, compliance environments, or when you need complete audit trails.

## Quick Decision Guide

**Just getting started?**
→ Use Pattern 3 with `@dexto/image-local`

**Building a production app?**
→ Use Pattern 1 with an official image

**Need to add 1-2 custom tools?**
→ Import image, then register your providers

**Building infrastructure (CLI/multi-tenant)?**
→ Use Pattern 2 (dynamic loading)

**Very specific requirements?**
→ Use Pattern 4 (no image, manual control)

**Need to distribute to your team?**
→ Create a custom image extending an official one

## Real-World Example: Discord Bot

Let's build a Discord bot step by step:

```typescript
// bot.ts
import '@dexto/image-local';  // Step 1: Load providers
import { DextoAgent, loadAgentConfig } from '@dexto/core';
import { Client, GatewayIntentBits } from 'discord.js';

// Step 2: Load agent config
const config = await loadAgentConfig('./agents/discord-bot.yml');
const agent = new DextoAgent(config, './agents/discord-bot.yml');
await agent.start();

// Step 3: Connect to Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Step 4: Handle messages
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const response = await agent.run(message.content);
  await message.reply(response);
});

client.login(process.env.DISCORD_TOKEN);
```

**What each layer does here:**
- **Core**: Provides DextoAgent class
- **Image**: Loads filesystem/process tools
- **Config**: Specifies Claude Sonnet as LLM
- **App**: Connects Discord to agent

## Common Questions

### "Do I need an image?"

**No!** Images are optional convenience. You can:
- Use an official image (easiest)
- Create a custom image (for teams)
- Skip images entirely (maximum control)

### "Can I use multiple images?"

Not in the same application. But you can:
- Switch images between runs (Pattern 2)
- Extend one image with your additions
- Host multiple agents with different images (multi-tenant)

### "When should I create a custom provider?"

When you need functionality that doesn't exist:
- API integrations (Salesforce, Jira, etc.)
- Custom storage backends
- Company-specific tools

See our [Building Custom Providers](./custom-providers) guide.

### "When should I create a custom image?"

When you need to distribute a standard setup:
- Multiple apps in your organization
- Open source distribution
- Reusable configurations

## Next Steps

import DocCardList from '@theme/DocCardList';

<DocCardList />

Or explore specific guides:
- [Building Custom Providers](./custom-providers) - Add new capabilities
- [Dexto SDK Guide](./dexto-sdk) - Using DextoAgent programmatically
- Check the configuring-dexto guides for agent configuration
- See image examples in the repository

---

**Still have questions?** Check out our [Architecture Concepts](../concepts/images-and-harnesses) or join our [Discord community](https://discord.gg/dexto).
