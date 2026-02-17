# `@dexto/image-local`

Local development image for Dexto.

This package default-exports a typed `DextoImage` (no side effects, no registries). Hosts
(CLI/server/apps) load the image and resolve config → concrete services via `@dexto/agent-config`.

## What’s included

- **Storage factories**: local filesystem blob store, SQLite database, in-memory cache (plus in-memory alternatives; Postgres/Redis factories are included but require optional deps)
- **Tool factories**: builtin, filesystem, process, todo, plan, agent-spawner
- **Hooks**: content-policy, response-sanitizer
- **Compaction**: reactive-overflow, noop
- **Logger**: core `defaultLoggerFactory`

## CLI usage

Install the image into the Dexto image store, then reference it from YAML:

```bash
dexto image install @dexto/image-local
```

```yaml
# agents/my-agent.yml
image: "@dexto/image-local"

systemPrompt:
  contributors:
    - type: static
      content: You are a helpful assistant.

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514

tools:
  - type: filesystem-tools
    allowedPaths: ["."]
    blockedPaths: [".git", "node_modules"]
  - type: process-tools
    securityLevel: moderate
```

Notes:
- Omit `tools:` to use `image.defaults.tools`.
- Storage defaults come from `image.defaults.storage` (override with `storage:` in YAML).
- `filesystem-tools.allowedPaths` is the static sandbox. In manual mode, attempts to access outside can trigger a directory access approval prompt and (if approved) allow access for the session or once.

## App usage (direct import)

```ts
import imageLocal from '@dexto/image-local';
import { DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import {
  AgentConfigSchema,
  applyImageDefaults,
  resolveServicesFromConfig,
  toDextoAgentOptions,
} from '@dexto/agent-config';

const configPath = './agents/my-agent.yml';
const raw = await loadAgentConfig(configPath);
const withDefaults = applyImageDefaults(raw, imageLocal.defaults);
const enriched = enrichAgentConfig(withDefaults, configPath);

const config = AgentConfigSchema.parse(enriched);
const services = await resolveServicesFromConfig(config, imageLocal);

const agent = new DextoAgent(toDextoAgentOptions({ config, services }));
await agent.start();
```
