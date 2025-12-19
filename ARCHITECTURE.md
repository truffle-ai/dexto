# Dexto Architecture: Understanding the Layers

> **📚 Looking for the complete guide?** See the full [Understanding Architecture](./docs/docs/guides/understanding-architecture.md) guide in our documentation for a more user-friendly explanation with examples.

This document provides a technical overview of how all of Dexto's layers fit together and when to use each approach.

## The Layer Model (Bottom-Up)

```
┌─────────────────────────────────────────────────────────────┐
│                      5. APPLICATION                         │
│  Your bot, CLI tool, web server - the user-facing code     │
│  • Discord bot  • Web app  • Custom CLI  • API service     │
└────────────────────────┬────────────────────────────────────┘
                         │ uses
┌────────────────────────▼────────────────────────────────────┐
│                   4. AGENT CONFIG (YAML)                    │
│  Instance configuration - which providers, tools, LLM       │
│  • systemPrompt  • llm  • customTools  • image (optional)   │
└────────────────────────┬────────────────────────────────────┘
                         │ requires
┌────────────────────────▼────────────────────────────────────┐
│                    3. IMAGE (Optional)                      │
│  Pre-bundled provider collections for specific contexts    │
│  • @dexto/image-local  • @dexto/image-cloud (future)       │
│  • Your custom images                                        │
└────────────────────────┬────────────────────────────────────┘
                         │ bundles
┌────────────────────────▼────────────────────────────────────┐
│                     2. PROVIDERS                            │
│  Implementations that plug into core's registries           │
│  • @dexto/tools-filesystem  • @dexto/tools-process         │
│  • Custom providers you build                               │
└────────────────────────┬────────────────────────────────────┘
                         │ register into
┌────────────────────────▼────────────────────────────────────┐
│                    1. CORE (@dexto/core)                    │
│  Contracts, interfaces, registries, orchestration           │
│  • DextoAgent  • Registries  • Schemas  • No providers     │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1: Core - The Foundation

**What it is:**
- Contracts and interfaces (TypeScript types)
- Registry pattern for extensibility
- The `DextoAgent` orchestration class
- Schemas for validation
- **Contains NO provider implementations**

**What it defines:**
```typescript
// Interfaces for providers to implement
interface CustomToolProvider { ... }
interface BlobStoreProvider { ... }

// Registries where providers register themselves
export const customToolRegistry = new Registry<CustomToolProvider>();
export const blobStoreRegistry = new Registry<BlobStoreProvider>();

// The orchestrator that uses registered providers
export class DextoAgent { ... }
```

**Analogy:** Like the Linux kernel - defines how everything should work, but doesn't include drivers or applications.

**When to import core directly:**
- Building applications with static imports (Pattern 1)
- Creating custom providers
- Advanced scenarios where you want full control

## Layer 2: Providers - Plugin Implementations

**What they are:**
- npm packages that implement core's interfaces
- Self-contained functionality (tools, storage, etc.)
- Register themselves into core's registries

**Examples:**
```typescript
// @dexto/tools-filesystem
export const fileSystemToolsProvider: CustomToolProvider = {
  type: 'filesystem-tools',
  initialize: async (config) => { ... },
  // Provides: read_file, write_file, edit_file, glob_files, grep_content
};

// @dexto/tools-process
export const processToolsProvider: CustomToolProvider = {
  type: 'process-tools',
  initialize: async (config) => { ... },
  // Provides: bash_exec, bash_output, kill_process
};
```

**Analogy:** Like device drivers in Linux - implement specific functionality that plugs into the kernel.

**When to build providers:**
- Adding new tool categories (e.g., API integration tools)
- Custom storage backends (e.g., MongoDB blob store)
- Organization-specific functionality

**How to build providers:**
```typescript
// my-custom-provider.ts
import { CustomToolProvider } from '@dexto/core';

export const myCustomProvider: CustomToolProvider = {
  type: 'my-tools',
  displayName: 'My Custom Tools',
  version: '1.0.0',

  async initialize(config, context) {
    return {
      tools: [
        {
          name: 'my_tool',
          description: 'Does something custom',
          inputSchema: { ... },
          execute: async (input) => { ... }
        }
      ]
    };
  }
};
```

## Layer 3: Images - Curated Provider Bundles (Optional)

**What they are:**
- npm packages that bundle multiple providers
- Side-effect imports that auto-register providers
- Re-export core utilities for convenience
- Target specific deployment contexts

**Structure:**
```typescript
// @dexto/image-local/dexto.image.ts
export default defineImage({
  name: 'image-local',
  version: '1.0.0',
  target: 'local-development',

  providers: {
    customTools: {
      register: async () => {
        const { fileSystemToolsProvider } = await import('@dexto/tools-filesystem');
        const { processToolsProvider } = await import('@dexto/tools-process');
        const { customToolRegistry } = await import('@dexto/core');

        customToolRegistry.register(fileSystemToolsProvider);
        customToolRegistry.register(processToolsProvider);
      }
    },
    blobStore: { ... },
    // ... other provider types
  },

  // Re-export everything from core for convenience
  exports: {
    '@dexto/core': ['*']
  }
});
```

**Official Images (Current and Planned):**

| Image | Providers | Use Case |
|-------|-----------|----------|
| `@dexto/image-local` | filesystem, process, local-sqlite, in-memory-cache | Local development, prototypes |
| `@dexto/image-cloud` (future) | S3, Postgres, Redis, no-filesystem | Production cloud deployments |
| `@dexto/image-edge` (future) | R2, D1, minimal | Serverless edge functions |
| `@dexto/image-browser` (future) | IndexedDB, no-filesystem, no-process | Browser environments |

**Analogy:** Like Linux distributions (Ubuntu, Alpine, Arch) - curated collections of packages for specific contexts.

**When to use images:**
- Getting started quickly (use official images)
- Standard deployment contexts
- Want batteries-included experience

**When to extend images:**
- Need official image + a few custom providers
- Building organizational distribution
- Creating reusable configurations for your team

**How to extend images:**
```typescript
// my-company-image/dexto.image.ts
export default defineImage({
  name: 'my-company-image',
  extends: '@dexto/image-local',  // Inherit everything

  providers: {
    customTools: {
      register: async () => {
        // Parent providers auto-registered
        // Add your custom ones
        const { myCustomProvider } = await import('./my-provider');
        const { customToolRegistry } = await import('@dexto/core');
        customToolRegistry.register(myCustomProvider);
      }
    }
  }
});
```

## Layer 4: Agent Config - Instance Configuration

**What it is:**
- YAML file with configuration data
- Specifies which tools, LLM, behaviors for ONE agent instance
- Can optionally declare required image
- Pure data - no code execution

**Structure:**
```yaml
# agent.yml
image: '@dexto/image-local'  # Optional - declares expected providers

systemPrompt: "You are a helpful coding assistant"

llm:
  provider: anthropic
  model: claude-sonnet-4

customTools:
  - type: filesystem-tools
    allowedPaths: ["."]
  - type: process-tools
    securityLevel: moderate

toolPolicies:
  alwaysAllow:
    - custom--filesystem-tools--read_file
    - custom--process-tools--bash_output
```

**Analogy:** Like docker-compose.yml or kubernetes manifests - declares what to run and how, but isn't the code itself.

**When to create configs:**
- Every agent instance needs one
- Different agents for different purposes (coding, writing, research)
- Multi-tenant scenarios (one config per tenant)

**Relationship to images:**
- Config CAN declare `image: '@dexto/image-local'` for documentation/validation
- Config uses providers that image provides (e.g., `filesystem-tools`)
- But config doesn't contain or load the image itself

## Layer 5: Application - User-Facing Code

**What it is:**
- The executable that ties everything together
- Loads images, configs, creates agents
- Provides user interface (CLI, web, bot, API)

**The Four Patterns:**

### Pattern 1: Static Import (Production Apps)
```typescript
// my-app.ts
import '@dexto/image-local';  // Load providers
import { DextoAgent, loadAgentConfig } from '@dexto/core';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
await agent.start();
```

**When:** Production apps, type safety critical

### Pattern 2: Dynamic Loading (Infrastructure)
```typescript
// CLI or multi-tenant server
import { DextoAgent, loadAgentConfig } from '@dexto/core';

const config = await loadAgentConfig('./agent.yml');

// Load image based on flag/config/env
if (cliFlag || config.image || process.env.DEXTO_IMAGE) {
  await import(imageName);
}

const agent = new DextoAgent(config, './agent.yml');
```

**When:** CLI tools, multi-tenant servers, need flexibility

### Pattern 3: Import from Image (Quick Start)
```typescript
// Simple app
import { DextoAgent, loadAgentConfig } from '@dexto/image-local';

const config = await loadAgentConfig('./agent.yml');
const agent = new DextoAgent(config, './agent.yml');
```

**When:** Prototypes, tutorials, simple apps

### Pattern 4: No Image (Advanced)
```typescript
// Build on core directly
import { DextoAgent, customToolRegistry } from '@dexto/core';
import { myCustomProvider } from './my-provider';

// Manually register only what you need
customToolRegistry.register(myCustomProvider);

const agent = new DextoAgent(config, './agent.yml');
```

**When:** Maximum control, minimal footprint, custom infrastructure

## Decision Tree: Which Approach Should I Use?

```
START: What are you building?
│
├─ Learning Dexto / Quick prototype?
│  └─→ Use Pattern 3 (Import from Image) + Official Image
│
├─ Production application?
│  ├─ Standard use case (local dev, cloud, etc.)?
│  │  └─→ Use Pattern 1 (Static Import) + Official Image
│  │
│  └─ Need custom functionality?
│     ├─ Just 1-2 custom tools?
│     │  └─→ Runtime Customization (import image, add providers)
│     │
│     ├─ Many custom tools for your team?
│     │  └─→ Extend Image (create company image)
│     │
│     └─ Very specific requirements?
│        └─→ Pattern 4 (No Image) + Manual Providers
│
├─ Infrastructure (CLI/multi-tenant)?
│  └─→ Use Pattern 2 (Dynamic Loading)
│
└─ Building new tool categories?
   └─→ Create Custom Provider Package
```

## Common Scenarios

### Scenario 1: Building a Discord Bot
```typescript
// bot.ts - Pattern 1 (Static Import)
import '@dexto/image-local';
import { DextoAgent, loadAgentConfig } from '@dexto/core';
import { Client } from 'discord.js';

const config = await loadAgentConfig('./agents/discord-bot.yml');
const agent = new DextoAgent(config, './agents/discord-bot.yml');

const client = new Client({ ... });
client.on('messageCreate', async (msg) => {
  const response = await agent.run(msg.content);
  await msg.reply(response);
});
```

### Scenario 2: Multi-Tenant SaaS Platform
```typescript
// server.ts - Pattern 2 (Dynamic Loading)
import { DextoAgent, loadAgentConfig } from '@dexto/core';

// Platform uses cloud image
await import('@dexto/image-cloud');

app.post('/tenant/:id/run', async (req, res) => {
  const config = await loadTenantConfig(req.params.id);

  // Validate tenant config matches platform
  if (config.image && config.image !== '@dexto/image-cloud') {
    return res.status(400).json({
      error: 'This platform requires @dexto/image-cloud'
    });
  }

  const agent = new DextoAgent(config, configPath);
  const response = await agent.run(req.body.message);
  res.json({ response });
});
```

### Scenario 3: Company-Wide Custom Image
```typescript
// my-company-image/dexto.image.ts - Extend Image
export default defineImage({
  name: '@mycompany/dexto-image',
  extends: '@dexto/image-cloud',

  providers: {
    customTools: {
      register: async () => {
        // Add company-specific tools
        const { salesforceTools } = await import('@mycompany/salesforce-tools');
        const { slackTools } = await import('@mycompany/slack-tools');
        const { customToolRegistry } = await import('@dexto/core');

        customToolRegistry.register(salesforceTools);
        customToolRegistry.register(slackTools);
      }
    }
  }
});

// team-app.ts - Teams use company image
import { DextoAgent } from '@mycompany/dexto-image';
// Now has: cloud providers + Salesforce + Slack tools
```

### Scenario 4: Minimal Agent (No Filesystem Access)
```typescript
// minimal-agent.ts - Pattern 4 (No Image)
import { DextoAgent, loadAgentConfig } from '@dexto/core';

// Don't load any image - no filesystem, no process tools
// Agent can only use LLM and internal tools (ask_user, delegate_to_url)

const config = await loadAgentConfig('./agents/chat-only.yml');
const agent = new DextoAgent(config, './agents/chat-only.yml');

// This agent is safe to run in untrusted environments
// It literally cannot access the filesystem or execute commands
```

## Key Principles

### 1. **Core is Contract-Only**
Core defines interfaces but provides NO implementations. This keeps it lightweight and unopinionated.

### 2. **Providers are Self-Contained**
Each provider is an independent npm package. Install only what you need.

### 3. **Images are Optional Convenience**
You never NEED an image. They're curated bundles for common scenarios. Advanced users can skip them entirely.

### 4. **Configs are Data, Not Code**
Agent configs are pure configuration. They can't execute code or load images themselves. The application layer handles that.

### 5. **Registration is Side-Effect Based**
Providers register themselves when imported. This keeps the application code clean - just import and use.

### 6. **Registries are Global Singletons**
All providers register into the same global registries, regardless of how they're loaded. This makes patterns composable.

## Migration Paths

### From Quick Start to Production
```
1. Start: Pattern 3 (Import from Image)
   import { DextoAgent } from '@dexto/image-local';

2. Need type safety: Pattern 1 (Static Import)
   import '@dexto/image-local';
   import { DextoAgent } from '@dexto/core';

3. Need custom tools: Runtime Customization
   import '@dexto/image-local';
   import { customToolRegistry } from '@dexto/core';
   customToolRegistry.register(myProvider);

4. Need to distribute: Extend Image
   Create @mycompany/dexto-image that extends image-local
```

### From Scratch to Distribution
```
1. Build Provider
   Create @mycompany/custom-provider

2. Use in App
   import { customToolRegistry } from '@dexto/core';
   import { myProvider } from '@mycompany/custom-provider';
   customToolRegistry.register(myProvider);

3. Bundle as Image
   Create @mycompany/dexto-image that includes your provider

4. Distribute
   Teams just: import from '@mycompany/dexto-image'
```

## Summary Table

| Layer | What | When to Touch | Analogy |
|-------|------|---------------|---------|
| Core | Contracts, DextoAgent, Registries | Always import (directly or via image) | Linux kernel |
| Providers | Tool implementations, storage backends | Building new capabilities | Device drivers |
| Images | Provider bundles | Getting started, creating distributions | Linux distros |
| Configs | Instance settings (YAML) | Every agent instance | docker-compose.yml |
| Application | Your user-facing code | Always (you're building this) | Your application |

## Next Steps

- **Learning Dexto?** Start with [Getting Started Guide](./docs/docs/getting-started)
- **Building an app?** See [Tutorials](./docs/docs/tutorials)
- **Creating providers?** See [Building Custom Providers](./docs/docs/guides/custom-providers.md)
- **Extending images?** See [Image Examples](./examples/image-examples/03-extending-image/)
- **Need help?** Check [Architecture Docs](./docs/docs/architecture)
