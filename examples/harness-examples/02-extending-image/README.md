# Example 2: Extending an Official Image

This example demonstrates how to **extend an official Dexto image** with your own custom providers while retaining all the benefits of the base image.

## What This Shows

The **extensibility pattern** - combine official images with custom providers:

1. **Start with Official Image** - `@dexto/image-local` provides storage/database/cache
2. **Add Custom Provider** - Register your own tool (weather helper)
3. **Best of Both Worlds** - Image handles infrastructure, you add domain logic
4. **Zero Boilerplate** - No need to register storage providers manually

## Use Case

Perfect when you:
- ✅ Want the convenience of an official image
- ✅ Need to add organization-specific tools
- ✅ Don't want to manage infrastructure providers yourself
- ✅ Want to ship custom functionality to your team

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

### Extension Pattern

```typescript
// Official image provides infrastructure
import { createAgent } from '@dexto/image-local';

// You add domain logic
import { customToolRegistry } from '@dexto/core';
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

✅ **Use Extension When:**
- You need 1-3 custom providers
- Building a single app or service
- Want to move fast
- Official image covers 90% of your needs

❌ **Don't Use Extension When:**
- Need 10+ custom providers (create custom image)
- Building a platform others will use (create custom image)
- Official image doesn't fit your needs (create custom image)

## See Also

- [Example 1: Using Official Image](../01-using-official-image/)
- [Example 3: Creating Custom Image](../03-creating-custom-image/)
- [Base Images Architecture](../../../feature-plans/architecture/02-base-images-and-implementation.md)
