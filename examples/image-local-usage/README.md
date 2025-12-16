# Image-Local Usage Example

This example demonstrates using the `@dexto/image-local` base image in a real application.

## What This Shows

The **power of base images** - zero boilerplate, just import and use:

1. **Import Pattern** - Import the base image with side-effect provider registration
2. **Zero Configuration** - Providers are automatically registered on import
3. **Clean API** - Use the `createAgent()` factory to create agents
4. **Image Metadata** - Access build information about the image

## Quick Start

### 1. Build Required Packages

From the Dexto root directory:

```bash
cd /path/to/dexto

# Build core packages (if not already built)
pnpm --filter @dexto/core build
pnpm --filter @dexto/agent-management build

# Build the image-local package
pnpm --filter @dexto/image-local build
```

### 2. Set Your API Key

The example uses OpenAI by default. Set your API key:

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

Or edit `agents/default.yml` to use a different provider.

### 3. Run the Example

```bash
cd examples/image-local-usage
pnpm start
```

Or run directly with tsx:

```bash
npx tsx src/index.ts
```

## What Happens

When you run the example, you'll see:

1. **Image Import** - The base image is imported with side effects
   ```typescript
   import { createAgent, imageMetadata } from '@dexto/image-local';
   ```
   - Blob storage providers registered automatically ✓
   - Database providers registered automatically ✓
   - Cache providers registered automatically ✓

2. **Config Loading** - Agent configuration loaded from YAML
   ```typescript
   const config = await loadAgentConfig('./agents/default.yml');
   ```

3. **Agent Creation** - Create agent using the factory
   ```typescript
   const agent = createAgent(config, './agents/default.yml');
   ```
   - All providers already registered from the image!
   - No manual `blobStoreRegistry.register()` needed
   - No boilerplate setup code

4. **Agent Usage** - Start agent and send messages
   ```typescript
   await agent.start();
   const session = await agent.createSession();
   const response = await agent.run(
       'Hello! Can you tell me about yourself in one sentence?',
       undefined, // imageDataInput
       undefined, // fileDataInput
       session.id // sessionId
   );
   ```

5. **Cleanup** - Stop agent gracefully
   ```typescript
   await agent.stop();
   ```

## Expected Output

```
🚀 Dexto Base Image Example

Using Base Image:
  Name:        image-local
  Version:     1.0.0
  Target:      local-development
  Built:       2025-12-16T13:57:05.753Z
  Core:        v1.3.0
  Constraints: filesystem-required, offline-capable

📝 Loading agent configuration...
✅ Config loaded

🤖 Creating agent...
✅ Agent created (providers already registered by image)
   No manual provider registration needed!

🔌 Starting agent...
✅ Agent started

📝 Creating session...
✅ Session created: b5fb26db-4da9-48cc-a129-73ec3c3f2553

💬 Testing agent...
📨 Agent response:
   I'm an AI assistant running on Dexto's local base image with filesystem storage.

🛑 Stopping agent...
✅ Agent stopped

✨ Example complete!
```

## File Structure

```
examples/image-local-usage/
├── agents/
│   └── default.yml          # Agent configuration
├── src/
│   └── index.ts             # Main example script
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

## Key Concepts

### 1. Side-Effect Registration

Providers are registered when you import the image:

```typescript
import { createAgent } from '@dexto/image-local'; // ← Registers providers automatically
```

The import triggers registration code that runs at module load time.

### 2. Factory Pattern

Use `createAgent()` instead of `new DextoAgent()`:

```typescript
const agent = createAgent(config, './agents/default.yml'); // Uses pre-registered providers
```

### 3. Image Metadata

Access image build information:

```typescript
import { imageMetadata } from '@dexto/image-local';

console.log(imageMetadata.name);        // 'image-local'
console.log(imageMetadata.version);     // '1.0.0'
console.log(imageMetadata.target);      // 'local-development'
console.log(imageMetadata.constraints); // ['filesystem-required', 'offline-capable']
```

## Comparison: Before vs After

### Before Base Images (Manual Setup)

```typescript
import { DextoAgent, blobStoreRegistry, databaseRegistry } from '@dexto/core';
import { localBlobProvider } from './providers/blob';
import { sqliteProvider } from './providers/database';
// ... more imports

// Manual registration - boilerplate!
blobStoreRegistry.register(localBlobProvider);
databaseRegistry.register(sqliteProvider);
// ... more registrations

const agent = new DextoAgent(config);
```

**~30 lines of boilerplate for every app!**

### After Base Images (Zero Boilerplate)

```typescript
import { createAgent } from '@dexto/image-local';

const agent = createAgent(config, './agents/default.yml'); // Providers already registered!
```

**3 lines - 90% reduction in boilerplate! 🎉**

## Customizing the Example

### Use a Different LLM Provider

Edit `agents/default.yml`:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

### Change Storage Configuration

The image provides defaults, but you can override them in `agents/default.yml`:

```yaml
storage:
  blob:
    type: local
    storePath: ./my-custom-blobs
  database:
    type: sqlite
    path: ./my-custom-db.sqlite
```

## Next Steps

- Explore the [image-local source code](../../packages/image-local/) to see how images are defined
- Read the [Base Images Architecture](../../feature-plans/architecture/02-base-images-and-implementation.md)
- Create your own base image with custom providers
- Build an application using this pattern

## Troubleshooting

**"sessionId is required" error:**
- Make sure you create a session before calling `agent.run()`
- Pass `sessionId` as the 4th parameter: `agent.run(text, undefined, undefined, sessionId)`

**"Missing API key" error:**
- Set the appropriate environment variable: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
- Or add `apiKey: $ENV_VAR_NAME` to your YAML config

**Import errors:**
- Make sure packages are built: `pnpm --filter @dexto/image-local build`
- Check that `@dexto/core` and `@dexto/agent-management` are also built

## See Also

- [Base Images Vision](../../feature-plans/architecture/02-base-images-and-implementation.md)
- [@dexto/image-local README](../../packages/image-local/README.md)
- [Provider Pattern Documentation](../../packages/core/src/providers/README.md)
