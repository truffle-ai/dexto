---
sidebar_position: 3
slug: /tutorials/images/03-building-your-image
---

# Building Your Own Image

When you're building harness infrastructure for multiple applications or establishing organizational standards, it's time to create your own Dexto image. This tutorial shows you how to package a custom harness as a distributable image.

## What You'll Learn

- How to create a distributable harness image
- Convention-based provider auto-discovery
- Extending official harness configurations
- Publishing your harness as an image to npm
- When to build a custom harness vs use runtime customization

## When to Build Your Own Image

✅ **Build an image when:**
- Sharing infrastructure across 3+ applications
- Establishing organizational standards
- Creating domain-specific distributions (healthcare, finance, etc.)
- Building a platform for your team

❌ **Don't build when:**
- Only need custom tools in 1-2 apps (use runtime customization)
- Providers are still experimental
- Just getting started (use official images)

## Project Structure

Images use convention-based folders that the bundler scans to build the harness:

```
my-image/
├── dexto.image.ts              # Image definition
├── tools/                      # Custom tools
│   └── weather-api/
│       └── index.ts           # Provider implementation
├── blob-store/                 # Storage providers
│   └── supabase/
│       └── index.ts
├── plugins/                    # Plugins
│   └── audit-logger/
│       └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

Each provider lives in its own folder with an `index.ts` file. The bundler discovers these and integrates them into the harness.

## Step 1: Create Your Image

```bash
dexto create-image my-org-image
```

You'll be prompted to:
1. Choose a starting point (new base or extend existing)
2. Select target environment (local, cloud, edge, custom)
3. Optionally include an example tool provider

This creates a project structure with:
- `dexto.image.ts` - Image definition
- `tools/`, `blob-store/`, `plugins/` - Convention-based folders
- `package.json` - With bundler scripts pre-configured
- `tsconfig.json` - TypeScript configuration

## Step 2: Review the Generated Structure

Open `dexto.image.ts` to see your image definition:

```typescript
import { defineImage } from '@dexto/core';

export default defineImage({
  name: 'my-org-image',
  version: '1.0.0',
  description: 'Custom agent infrastructure for MyOrg',
  target: 'cloud-production',

  defaults: {
    storage: {
      blob: { type: 'supabase' },
      database: { type: 'postgres' },
    },
  },
});
```

## Step 3: Add Custom Providers

Create `tools/weather-api/index.ts`:

```typescript
import { z } from 'zod';
import type { CustomToolProvider } from '@dexto/core';

export const weatherApiProvider: CustomToolProvider<'weather-api'> = {
  type: 'weather-api',

  // Configuration schema
  configSchema: z.object({
    type: z.literal('weather-api'),
    apiKey: z.string(),
  }),

  // Create tools from config
  create: (config, context) => [
    {
      id: 'get_weather',
      description: 'Get current weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),

      // Tool execution
      execute: async ({ location }) => {
        const response = await fetch(
          `https://api.weather.com/current?location=${location}`,
          { headers: { Authorization: `Bearer ${config.apiKey}` } }
        );
        return await response.json();
      },
    },
  ],

  metadata: {
    displayName: 'Weather API',
    description: 'Real-time weather data',
    category: 'utilities',
  },
};
```

The bundler will discover this provider and integrate it into your harness automatically.

## Step 4: Build Your Image

```bash
npm run build
```

The bundler scans your convention-based folders (`tools/`, `blob-store/`, `plugins/`), discovers all `index.ts` files, and generates registration code that runs when the image is imported. The result is `dist/index.js` - a distributable harness with all providers pre-registered.

## Step 5: Use Your Image

In another project:

```typescript
import { createAgent } from '@myorg/image-myorg';
import { loadAgentConfig } from '@dexto/agent-management';

const config = await loadAgentConfig('./agents/default.yml');
const agent = createAgent(config, './agents/default.yml');
// Has all your custom providers built-in!
```

## Extending Official Images

Instead of building from scratch, you can extend an official image:

```bash
dexto create-image my-extended-image
```

When prompted for "Starting point", choose "Extend existing image" and select `@dexto/image-local` as the base.

This generates an image that extends the official harness:

```typescript
// dexto.image.ts
import { defineImage } from '@dexto/core';

export default defineImage({
  name: 'my-extended-image',
  version: '1.0.0',
  extends: '@dexto/image-local',

  defaults: {
    storage: {
      blob: { type: 'supabase' },
    },
  },
});
```

Your harness includes all providers from the base image plus any custom providers you add to the convention-based folders.

## Convention-Based Discovery

The bundler automatically discovers providers and integrates them into the harness:

| Folder | Provider Type | Example |
|--------|---------------|---------|
| `tools/*/index.ts` | Custom tools | `tools/weather-api/index.ts` |
| `blob-store/*/index.ts` | Blob storage | `blob-store/supabase/index.ts` |
| `compression/*/index.ts` | Compression | `compression/sliding-window/index.ts` |
| `plugins/*/index.ts` | Plugins | `plugins/audit-logger/index.ts` |

Only `index.ts` files are registered as providers. Other files in the same folder can be imported as helpers:

```
tools/
└── weather-api/
    ├── index.ts              # Provider (discovered by bundler)
    ├── helpers.ts            # Utilities (imported by index.ts)
    └── types.ts              # Types (imported by index.ts)
```

## Image Metadata at Runtime

Users of your image can access metadata:

```typescript
import { imageMetadata } from '@myorg/my-image';

console.log(imageMetadata.name);          // 'my-image'
console.log(imageMetadata.version);       // '1.0.0'
console.log(imageMetadata.target);        // 'cloud-production'
```

## Comparison: Runtime vs Build-Time

| Aspect | Runtime Customization | Building Image |
|--------|---------------------|----------------|
| **When** | App startup | Build time |
| **Output** | Extended harness (local) | New distributable harness |
| **Distribution** | App-specific | Publish to npm |
| **Use Case** | 1-2 custom tools | Org-wide harness standards |
| **Dependencies** | No @dexto/core | @dexto/core (dev only) |
| **Build Step** | No | Yes |
| **Auto-Discovery** | No (manual registration) | Yes (harness auto-configures) |

## Next Steps

- [Building a Web App](/docs/tutorials/images/04-building-web-app) - Use your image in a web service
- [Provider Development](https://github.com/truffle-ai/dexto/blob/main/packages/core/src/providers/README.md) - Deep dive
- [Examples](https://github.com/truffle-ai/dexto/tree/main/examples/image-examples) - More examples

## Key Takeaways

✅ Use convention-based folders - the bundler builds the harness automatically
✅ Extend official harnesses when possible
✅ Package your harness as an image and publish to npm
✅ Perfect for sharing harness infrastructure across teams
✅ Follow semantic versioning for harness releases
✅ Document and test your harness thoroughly
