# Example 2: Runtime Customization

This example demonstrates how to **add custom tools at runtime** to an official Dexto image without building a new image.

## What This Shows

The **runtime customization pattern** - use an official image and add app-specific tools:

1. **Start with Official Image** - `@dexto/image-local` provides storage/database/cache
2. **Add Custom Tools at Runtime** - Register your own tool (weather helper) at app startup
3. **No Build Step Required** - Just register and use, no image building
4. **Zero Boilerplate** - No need to register storage providers manually

## Use Case

Perfect when you:
- ✅ Want the convenience of an official image
- ✅ Need to add 1-2 app-specific tools
- ✅ Don't want to manage infrastructure providers yourself
- ✅ Don't need to distribute your custom tools as a package

## Quick Start

### 1. Build Required Packages

From the Dexto root directory:

```bash
cd /path/to/dexto

# Build dependencies
pnpm --filter @dexto/core build
pnpm --filter @dexto/agent-management build
pnpm --filter @dexto/image-local build
```

### 2. Set Your API Key

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

### 3. Run the Example

```bash
cd examples/harness-examples/02-extending-image
pnpm start
```

## Key Concepts

### Runtime Customization Pattern

```typescript
// Official image provides infrastructure
import { createAgent, customToolRegistry } from '@dexto/image-local';

// You add domain logic at runtime (no build step!)
customToolRegistry.register(yourCustomTool);

// Agent has both!
const agent = createAgent(config);
```

### What You Get vs What You Add

**From Image (Free):**
- Storage infrastructure (blob store, database, cache)
- Default configurations
- Provider registrations
- Lifecycle helpers

**From You (Custom):**
- Domain-specific tools
- Organization-specific integrations
- Custom business logic
- Specialized plugins

## When to Use This Pattern

✅ **Use Runtime Customization When:**
- You need 1-2 app-specific custom tools
- Building a single app or service
- Want to move fast without a build step
- Official image covers 90% of your needs
- Tools don't need to be shared across multiple apps

❌ **Don't Use Runtime Customization When:**
- Need 3+ custom providers to share across apps (create custom image instead - see Example 3)
- Building a platform others will use (create custom image instead)
- Want to distribute tools as a package (create custom image instead)

## See Also

- [Example 1: Using Official Image](../01-using-official-image/)
- [Example 3: Extending Image (Build-time)](../03-extending-image/) - For distributable custom images
- [Base Images Architecture](../../../feature-plans/architecture/02-base-images-and-implementation.md)
