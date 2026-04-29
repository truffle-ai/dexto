# `@dexto/image-local`

Local development image for Dexto.

This package default-exports a typed `DextoImage` (no side effects, no registries). Hosts
(CLI/server/apps) load the image and resolve config → concrete services via `@dexto/agent-config`.

## What’s included

- **Stores**: local `DextoStores` built with filesystem artifacts, SQLite session data, and in-memory fast state by default
- **Workspace handles**: local filesystem workspace handles for local CLI/app runs
- **Skill sources**: local and plugin skill directories loaded through `SkillManager`
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
- Store defaults come from `image.defaults.storage` and are resolved by `storage.createStores(...)`.
- `filesystem-tools.allowedPaths` defines the static sandbox. In manual mode, attempts to access paths outside the sandbox trigger a directory access approval prompt; if approved, access is granted for the current session or for a single occurrence.

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
