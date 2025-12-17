# Example 3: Extending an Image

> **Pattern: Creating a NEW distributable image by extending a base image**

This example demonstrates **true image extension** - building a new image that inherits from a base image and adds custom providers.

## Concept

This is fundamentally different from runtime customization (Example 2):

| Aspect | Runtime Customization (Ex 2) | Image Extension (Ex 3) |
|--------|------------------------------|------------------------|
| **When** | App startup | Build time |
| **Output** | App with custom tools | NEW distributable image |
| **Distribution** | App-specific | Can publish to npm |
| **Use Case** | 1-2 app-specific tools | Org-wide standard |
| **Dependencies** | No @dexto/core | Uses @dexto/core (dev only) |

## Structure

```
03-extending-image/
├── dexto.image.ts              # Extends @dexto/image-local
├── tools/
│   └── weather-helper/
│       ├── index.ts            # Auto-discovered, bundled into image
│       └── helpers.ts          # Helper functions (optional)
├── package.json                # Can publish as @myorg/image-weather
└── README.md
```

## How It Works

1. **Define Extension**:
   ```typescript
   // dexto.image.ts
   export default defineImage({
     name: 'image-weather',
     extends: '@dexto/image-local',  // Inherit everything
     // Custom providers auto-discovered from tools/*/index.ts
   });
   ```

2. **Build New Image**:
   ```bash
   dexto-bundle build
   ```

3. **Result**: `dist/index.js` contains:
   - All providers from `@dexto/image-local` (text-utils, storage, etc.)
   - Plus your weather-helper tool
   - Ready to publish to npm

## Usage

After building and publishing this image:

```typescript
// In another app
import { createAgent } from '@myorg/image-weather';

const agent = createAgent(config);
// Has BOTH text-utils AND weather-helper built-in!
```

## Current Status

**Note**: The `extends` field is conceptually shown but may need additional bundler implementation. For now, this example demonstrates the structure and pattern. The bundler would need to:

1. Resolve the base image dependency
2. Import and register base image providers
3. Add custom providers on top
4. Generate combined image output

## When to Use This Pattern

✅ **Use image extension when:**
- Creating organization-specific images
- Need to share custom providers across 3+ apps
- Want to publish to npm
- Establishing team/org standards

❌ **Don't use when:**
- Only need custom tools in 1-2 apps → Use runtime customization (Example 2)
- Providers are still experimental → Wait until stable

## Build

```bash
# Install dependencies
pnpm install

# Build the extended image
pnpm run build

# Output: dist/index.js, dist/index.d.ts
```

## Future Enhancement

When `extends` is fully implemented in the bundler, this will be even simpler:

```typescript
export default defineImage({
  name: 'image-weather',
  extends: '@dexto/image-local',  // That's it!
  // Everything else is automatic
});
```

The bundler would automatically:
- Import base image providers
- Discover custom providers from folders
- Merge defaults and constraints
- Generate combined output
