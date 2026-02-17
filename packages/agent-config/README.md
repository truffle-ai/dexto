# `@dexto/agent-config`

Schema + resolver utilities for turning an agent YAML config into concrete DI surfaces using images.

This package is **product-layer glue**: core (`@dexto/core`) stays DI-friendly, and hosts (CLI/server/apps)
use `@dexto/agent-config` to:

- validate agent config (`AgentConfigSchema`)
- load an image module (`loadImage()`)
- merge image defaults into raw config (`applyImageDefaults()`)
- resolve factories from the image into concrete instances (`resolveServicesFromConfig()`)
- convert the result into `DextoAgentOptions` (`toDextoAgentOptions()`)

## Quick example (apps)

```ts
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig } from '@dexto/agent-management';
import {
  AgentConfigSchema,
  applyImageDefaults,
  loadImage,
  resolveServicesFromConfig,
  setImageImporter,
  toDextoAgentOptions,
} from '@dexto/agent-config';

// Under pnpm (strict dependency boundaries), configure image importing at the host entrypoint.
setImageImporter((specifier) => import(specifier));

const raw = await loadAgentConfig('./agents/my-agent.yml');
const image = await loadImage(raw.image ?? '@dexto/image-local');
const merged = applyImageDefaults(raw, image.defaults);

const config = AgentConfigSchema.parse(merged);
const services = await resolveServicesFromConfig(config, image);

const agent = new DextoAgent(toDextoAgentOptions({ config, services }));
await agent.start();
```

## Images (no registries)

Images are typed modules (`DextoImage`) that export plain `Record<string, Factory>` maps.
Resolver logic does property access by config `type` (e.g., `image.tools[entry.type]`) — there are no
global registries or side effects.
