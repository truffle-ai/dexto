# Image + Core DI Refactor Plan

This plan captures the current problems, the target architecture, and concrete before/after behavior with code snippets. It is written to preserve the current CLI UX while making core DI‑friendly and fixing the image system.

---

## 1. Problems

### Coupling + typing issues
- **Core is tightly coupled to config**: `StorageManager` and tool creation resolve providers from config (string `type`) inside core. This requires global registries and makes core dependent on higher‑level configuration concerns.
- **Image layer erases types**: `ImageProvider` and `ImageDefaults` use `any` heavily (`configSchema: z.ZodType<any>`, `create: (config: any, deps: any) => any`, `[key: string]: any` index signatures). The image layer discards the stronger types used by provider packages.
- **Image defaults aren't applied**: image `defaults` exist in definitions but are **not merged into agent config anywhere at runtime**. For example, `defaults.customTools` in `image-local` is never merged — it's dead metadata. This is a silent bug.
- **Bundler uses `.toString()` injection**: `register` functions are stringified via `.toString()`, regex‑stripped (`replace(/^async\s*\(\)\s*=>\s*{/, '')`), and inlined into generated code. This is brittle (closures break, minification breaks, relative imports break) and not type‑checked.
- **Duck‑typed auto‑discovery**: bundler registers any exported object with `type` + `create` properties, which can unintentionally register unrelated exports.
- **Global mutable registries**: 6 provider registries (`customToolRegistry`, `blobStoreRegistry`, `databaseRegistry`, `cacheRegistry`, `pluginRegistry`, `compactionRegistry`) are module‑level singletons. Registration is order‑dependent, there is no isolation between agents in the same process, and tests must call `.clear()` to avoid pollution.
- **Image runtime divergence**: `image-local` uses bundler‑generated entrypoints with `imageMetadata` export; `image-cloud` uses hand‑written `index.ts` with `imageCloud` export (different shape). No shared contract is enforced. The CLI uses `|| null` fallbacks that silently ignore missing metadata.
- **Mix of inline + convention approaches**: The bundler supports both inline `register()` functions and convention‑based folder discovery, but neither is well‑documented, and no production image uses convention‑based discovery. This creates confusion about the canonical approach.
- **`defineImage()` adds minimal value**: It validates three string fields and returns the same object. The TypeScript interface is full of `any` and index signatures, so type checking is minimal. Compare to `defineConfig` in Vite which provides rich IntelliSense.
- **`Requirements of registries to extend core for almost every feature surface`** - plugins, compaction, tools, storage, etc. This should be through DI

### Platform & repo‑level issues
- **Duplication of logic**: platform re‑implements behavior already present in open‑source `@dexto/*` (e.g., Hono API contracts, client SDK patterns), increasing drift.
- **Inconsistent "image" usage**: platform imports `image-cloud` as a side‑effect with fire‑and‑forget promise (no `await`), but does not integrate image metadata consistently. This makes defaults and capabilities unclear.
- **Config can't express code**: The config‑based paradigm makes it difficult to inject custom code as hooks/plugins. Users building coding agents or domain‑specific agents hit a wall where YAML can't express their customization needs.

---

## 2. Goals

1. **DI‑friendly core**: core should accept concrete services (storage, tools, plugins) rather than resolve config internally.
2. **Preserve CLI UX**: CLI still uses config files (`agent.yml`) and the `image` concept, but moves resolution to the CLI/platform layer.
3. **Keep images as powerful extension points**: images remain a first‑class way to bundle tools + defaults for distribution, but with no side effects, no `.toString()` code‑gen, and full type safety.
4. **Type safety**: zero `any` types in image contracts. Proper type inference. Generated code uses explicit imports, not duck‑typing.
5. **Reduce duplication and drift**: enforce shared contracts (API, SDK, auth) across platform and OSS where possible.
6. **Testability**: images and the resolver should be independently testable without importing core or starting an agent. You should be able to unit test `resolveServicesFromConfig()` with mock registries and verify it produces the right concrete instances. The current image system has zero tests.
7. **Enable code‑based agent customization**: alongside the config‑based paradigm, offer a framework/library path where users write TypeScript to build agents with custom tools and hooks, deployable to the Dexto platform (similar to how a Next.js project deploys to Vercel).

---

## 3. Where this lives (one new package)

We will add **one** new package: `@dexto/agent-config` to prevent `agent-management` from becoming a mega‑package and to make the DI boundary explicit.

### A) `@dexto/core` (runtime only)
- Add **DI‑friendly constructors** for agent/runtime pieces (storage/tools/services).
- **Stop resolving config inside core**; core should accept concrete instances for code‑based surfaces (storage, tools, plugins, logger) and config objects for data‑based surfaces (prompts, policies, sessions).
- **Remove registries from core entirely.** No `BaseRegistry`, no global singletons, no provider registries.
- Ensure we don't overdo this — things like LLM, MCP, system prompts, and session policies are naturally config‑driven and don't need DI.

### B) `@dexto/agent-config` (new) — config + resolution
- Own config parsing/validation and enrichment.
- Apply **image default merging** explicitly (shallow merge, config wins).
- Provide `resolveServicesFromConfig()` that reads from the image's factory maps to build concrete instances.
- Be the single entry point for config → runtime resolution used by CLI and platform.
- **No registries.** The image object itself is the lookup table (`Record<string, Factory>`). No `BaseRegistry` class needed anywhere.

### C) `@dexto/agent-management` (registry + distribution)
- Keep agent registry, agent install/discovery, CLI helpers.
- Remove config parsing/resolution responsibilities.

### D) `@dexto/cli` + platform apps (product layer)
- Choose image (`config.image` / `--image`), load it, register its providers, and resolve services **before** constructing core runtime.
- This preserves CLI UX exactly while moving config‑coupling out of core.

### E) `@dexto/image-*` (images as typed modules)
- Keep images as distributable image modules, but **remove side‑effect imports and `.toString()` bundling**.
- Each image exports a typed `DextoImageModule` object (see Section 4 for interface).
- Ensure we have proper type safety. Zero `any` types. Proper type inference.
- Eliminate unneeded and unused parameters. No space for slop.

### UX compatibility
- **CLI flags stay the same**: `--image`, config `image:` field, etc.
- CLI still reads YAML, but the **resolution happens above core**.
- Image selection still works identically from the user's POV.

### Why this solves the problems
- **Core is no longer config‑coupled** (DI‑friendly).
- **No registries anywhere.** Images export plain `Record<string, Factory>` objects. The resolver reads from them directly.
- **Images become explicit typed modules** (predictable, testable).
- **No bundler string injection**; no duck‑typing of exports.

---

## 4. Before/After — Images

### Before (current image: side‑effect registration + bundler)
```ts
// dexto.image.ts — inline register functions
export default defineImage({
  name: 'image-local',
  providers: {
    blobStore: {
      register: async () => {
        const { localBlobStoreProvider } = await import('@dexto/core');
        const { blobStoreRegistry } = await import('@dexto/core');
        blobStoreRegistry.register(localBlobStoreProvider);
      },
    },
  },
  defaults: {
    storage: { blob: { type: 'local', storePath: './data/blobs' } },
  },
});
```

Bundler inlines `register()` via `.toString()` into generated JS:
```js
await (async () => {
  // inlined register() body — extracted via regex, not type‑checked
  const { localBlobStoreProvider } = await import('@dexto/core');
  blobStoreRegistry.register(localBlobStoreProvider);
})();
```

### After: `DextoImageModule` interface

The image itself IS the lookup table. No registries, no `register()` method. Each extension point is a `Record<typeString, Factory>`.

```ts
interface DextoImageModule {
  metadata: {
    name: string;
    version: string;
    description: string;
    target?: ImageTarget;
    constraints?: ImageConstraint[];
  };
  defaults?: ImageDefaults;  // Typed defaults, no index signatures

  // Each extension point: Record<type string from config, factory>
  tools: Record<string, ToolFactory>;
  storage: Record<string, StorageFactory>;
  plugins: Record<string, PluginFactory>;
  compaction: Record<string, CompactionFactory>;
}

// Tool factory: one config entry can produce multiple tools (grouping)
interface ToolFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, context: ToolCreationContext): Tool[];
  metadata?: { displayName: string; description: string; category: string };
}

// Storage factory: produces a single storage backend instance
interface StorageFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, context: StorageCreationContext): BlobStore | Database | Cache;
}

// Plugin/compaction factories follow the same pattern
interface PluginFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, context: PluginCreationContext): Plugin;
}

interface CompactionFactory {
  configSchema: z.ZodSchema;
  create(config: unknown): CompactionStrategy;
}
```

**Why this works:** Config uses type strings (`type: 'filesystem-tools'`). The image provides a plain object mapping those type strings to factories. The resolver does `image.tools[config.type]` — a property access, not a registry lookup. Composing images is just object spread: `{ ...baseImage.tools, ...childImage.tools }`.

### Two ways to produce a `DextoImageModule`

Both produce the same runtime interface. The consumer doesn't care which was used.

#### A) Convention‑based (bundler generates `register()` from folders)

For images with **custom code** living inside the image package:

```
my-image/
├── dexto.image.ts          ← metadata + defaults only
├── tools/
│   ├── jira/
│   │   ├── index.ts        ← exports provider
│   │   ├── api-client.ts
│   │   └── types.ts
│   └── salesforce/
│       └── index.ts
├── storage/
│   └── gcs/
│       └── index.ts
└── plugins/
    └── audit-log/
        └── index.ts
```

Convention folders:
- `tools/` — custom tool providers
- `storage/` — storage backends (blob, database, cache — all in one folder)
- `plugins/` — lifecycle plugins
- `compaction/` — compaction strategy providers

Each subfolder's `index.ts` exports a named `provider` export (explicit contract, no duck‑typing):
```ts
// tools/jira/index.ts
export const provider: ToolFactory = {
  configSchema: JiraConfigSchema,
  create: (config, context) => [jiraQueryTool, jiraCreateIssueTool, ...],
  metadata: { displayName: 'Jira Tools', description: '...', category: 'integrations' },
};
```

The bundler discovers these folders, generates **explicit imports into a plain object** (no `.toString()`, no registries):
```ts
// Generated dist/index.js
import { provider as jira } from './tools/jira/index.js';
import { provider as salesforce } from './tools/salesforce/index.js';
import { provider as gcs } from './storage/gcs/index.js';
import { provider as auditlog } from './plugins/audit-log/index.js';
import imageConfig from './dexto.image.js';

const image: DextoImageModule = {
  metadata: imageConfig.metadata,
  defaults: imageConfig.defaults,
  tools: {
    'jira': jira,                // folder name = type string
    'salesforce': salesforce,
  },
  storage: {
    'gcs': gcs,
  },
  plugins: {
    'audit-log': auditlog,
  },
  compaction: {},
};

export default image;
```

**The folder name becomes the type string used in config.** E.g. `tools/jira/` → `type: 'jira'` in YAML. Simple, predictable convention.

#### B) Hand‑written (for images that re‑export from external packages or need full control)

For images like `image-local` where providers come from existing `@dexto/*` packages:

```ts
// image-local/index.ts
import { localBlobStoreFactory, inMemoryBlobStoreFactory, sqliteFactory, inMemoryCacheFactory } from '@dexto/core';
import { fileSystemToolsProvider } from '@dexto/tools-filesystem';
import { processToolsProvider } from '@dexto/tools-process';
import { todoToolsProvider } from '@dexto/tools-todo';
import { planToolsProvider } from '@dexto/tools-plan';
import { agentSpawnerToolsProvider } from '@dexto/agent-management';

const image: DextoImageModule = {
  metadata: {
    name: 'image-local',
    version: '1.0.0',
    description: 'Local development image with filesystem and process tools',
    target: 'local-development',
    constraints: ['filesystem-required', 'offline-capable'],
  },
  defaults: {
    storage: {
      blob: { type: 'local', storePath: './data/blobs' },
      database: { type: 'sqlite', path: './data/agent.db' },
      cache: { type: 'in-memory' },
    },
    customTools: [
      { type: 'filesystem-tools', allowedPaths: ['.'], blockedPaths: ['.git', '.env'] },
      { type: 'process-tools', securityLevel: 'moderate' },
      { type: 'todo-tools' },
    ],
  },
  // Plain objects — the image IS the lookup table
  tools: {
    'filesystem-tools': fileSystemToolsProvider,   // already has configSchema + create()
    'process-tools': processToolsProvider,
    'todo-tools': todoToolsProvider,
    'plan-tools': planToolsProvider,
    'agent-spawner': agentSpawnerToolsProvider,
  },
  storage: {
    'local': localBlobStoreFactory,
    'in-memory-blob': inMemoryBlobStoreFactory,
    'sqlite': sqliteFactory,
    'in-memory': inMemoryCacheFactory,
  },
  plugins: {},
  compaction: {},
};

export default image;
```

No bundler needed. No registries. Standard TypeScript. Full type safety. Debuggable.

**Key insight:** The existing `fileSystemToolsProvider` object (with `type`, `configSchema`, `create()`) is already almost exactly a `ToolFactory`. The only change is where it lives — as a property on the image object instead of being registered into a global singleton.

#### `include` shorthand (future enhancement)

For the convention‑based bundler, an optional `include` field in `dexto.image.ts` could allow declaring external package re‑exports without needing wrapper files:

```ts
// dexto.image.ts — future enhancement
export default defineImage({
  name: 'image-local',
  include: {
    tools: ['@dexto/tools-filesystem', '@dexto/tools-process'],
    storage: ['@dexto/core/blob-local'],
  },
  defaults: { ... },
});
```

The bundler would generate explicit imports for these alongside convention folder discoveries. **Not required for v1 — document as future enhancement.**

#### Convention folder configurability (future enhancement)

A separate config file (not `dexto.image.ts`) could allow overriding default folder paths, similar to how `next.config.ts` allows `src/` directory. **Not required for v1 — document as future enhancement.** Ship with fixed conventions first (`tools/`, `storage/`, `plugins/`, `compaction/`), add configurability when someone actually needs it.

#### Migration: `image-cloud`
`image-cloud` currently uses hand‑written `index.ts` with fire‑and‑forget registration. It must be migrated to export a `DextoImageModule` object with factory maps. Providers in `apps/platform/src/` can stay where they are — the hand‑written image just imports them and puts them in the right `Record` property.

**Verify (before)**
- `/Users/karaj/Projects/dexto/packages/image-local/dexto.image.ts`
- `/Users/karaj/Projects/dexto/packages/image-bundler/src/generator.ts`
- `/Users/karaj/Projects/dexto-cloud/apps/platform/image-cloud/dexto.image.ts`
- `/Users/karaj/Projects/dexto-cloud/apps/platform/image-cloud/index.ts`

---

## 5. Before/After — Core

### Before (config‑driven core, full flow)
**Entry → DextoAgent → Service Initializer → Storage/Tools via registries**

1) **DextoAgent constructor** validates config and creates logger:
```ts
const schema =
  options?.strict === false ? createAgentConfigSchema({ strict: false }) : AgentConfigSchema;
this.config = schema.parse(config);
this.logger = createLogger({ config: this.config.logger, agentId: this.config.agentId, ... });
```

2) **DextoAgent.start** calls the service initializer:
```ts
const services = await createAgentServices(
  this.config,
  this.configPath,
  this.logger,
  this.agentEventBus,
  this.serviceOverrides
);
```

3) **createAgentServices** wires everything **from config**:
```ts
const storageManager = await createStorageManager(config.storage, logger);
const approvalManager = new ApprovalManager({ toolConfirmation: config.toolConfirmation, elicitation: config.elicitation }, logger);
const mcpManager = new MCPManager(logger);
await mcpManager.initializeFromConfig(config.mcpServers);
const searchService = new SearchService(storageManager.getDatabase(), logger);
const memoryManager = new MemoryManager(storageManager.getDatabase(), logger);
const pluginManager = new PluginManager({ agentEventBus, storageManager, configDir }, logger);
await pluginManager.initialize(config.plugins.custom, config.plugins.registry);
const resourceManager = new ResourceManager(mcpManager, { ... }, logger);
const toolManager = new ToolManager(...config.customTools, config.internalTools, ...);
const systemPromptManager = new SystemPromptManager(config.systemPrompt, configDir, memoryManager, config.memories, logger);
const sessionManager = new SessionManager({ stateManager, systemPromptManager, toolManager, ... }, { ... }, logger);
```

4) **Storage uses registries internally** (core resolves providers):
```ts
this.cache = await createCache(this.config.cache, this.logger);
this.database = await createDatabase(this.config.database, this.logger);
this.blobStore = createBlobStore(this.config.blob, this.logger);
```

### After (DI‑driven core, full flow)
**Entry → agent-config resolver → concrete instances → DextoAgent**

#### What becomes DI vs. what stays config

| Module | After | Reason |
|--------|-------|--------|
| Storage (blob, database, cache) | **DI** — accept concrete instances | These are code‑level backends with different implementations |
| Tools | **DI** — accept concrete `Tool[]` | Tools are code, not data. Core sees a flat list of tool objects. |
| Plugins | **DI** — accept concrete `Plugin[]` | Plugins are lifecycle hooks = code |
| Logger | **DI** — accept concrete `Logger` instance | Logger is a service |
| LLM | **Config** — keep as provider/model/apiKey | Naturally config‑driven, doesn't need DI |
| System prompt + memories | **Config** — keep as data | Prompts are text/data |
| Compaction | **DI** — accept concrete `CompactionStrategy` | Strategy is code; resolver creates instance from image's compaction factories |
| MCP servers | **Config** — keep as server definitions | Runtime connects to external processes |
| Approval policies | **Config** — keep as policy data | Policies are data |
| Sessions | **Config** — keep as settings | Settings are data |
| Resources | **Config** — keep as resource definitions | Resource specs are data |
| Prompts | **Config** — keep as prompt definitions | Prompts are data |
| Telemetry | **Config** — keep as settings | Settings are data |

**This is a massive refactor.** Every module that currently reads config and creates its own instances needs to instead accept pre‑created instances. The refactor touches almost every module in core.

#### Proposed DextoAgent surface (explicit + exhaustive)

```ts
new DextoAgent({
  // Identity & UX
  agentId: 'coding-agent',
  agentCard: { name: 'Coding Agent', version: '1.0.0' },
  greeting: 'Hi!',

  // LLM (config‑based — naturally config‑driven)
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', apiKey: '...' },

  // System prompt + memory (config‑based — these are data)
  systemPrompt: { ... },
  memories: { ... },

  // Storage (DI — concrete instances, no type strings)
  storage: {
    blob: BlobStoreInstance,
    cache: CacheInstance,
    database: DatabaseInstance,
  },

  // Tools (DI — flat list of concrete tool objects)
  tools: Tool[],

  // Plugins (DI — concrete plugin instances)
  plugins: Plugin[],

  // Compaction (DI — concrete strategy instance)
  compaction: CompactionStrategy,

  // Logger (DI — concrete instance)
  logger: LoggerInstance,

  // MCP servers (config‑based — runtime connects)
  mcpServers: { ... },

  // Session + approval policies (config‑based — policies are data)
  sessions: { ... },
  toolConfirmation: { ... },
  elicitation: { ... },

  // Resources + prompts (config‑based — these are data)
  internalResources: [ ... ],
  prompts: [ ... ],

  // Telemetry (config‑based)
  telemetry: { enabled: true, ... },
});
```

**Key changes from previous draft:**
- **`tools` is a flat `Tool[]`** — no providers concept in core. The "provider" pattern (factory that creates tools from config) only exists in the resolver layer.
- **`plugins` is a flat `Plugin[]`** — same principle.
- **`logger` is a concrete instance** — not config.
- **No `overrides` escape hatch** — everything is explicit. If you need to customize a manager, construct the services yourself.

#### New flow (after)

1) **Product layer** loads config and applies image defaults:
```ts
const rawConfig = loadAgentConfig(...);
const image = await loadImage(imageName);  // dynamic import, returns DextoImageModule
const mergedConfig = applyImageDefaults(rawConfig, image.defaults);
// Shallow merge. Config wins over defaults.
```

2) **Resolver builds concrete instances** (reads from image's factory maps, no registries):
```ts
const resolved = resolveServicesFromConfig(mergedConfig, image);
// resolved.storage = { blob: BlobStore, database: Database, cache: Cache }
// resolved.tools = Tool[]
// resolved.plugins = Plugin[]
// resolved.compaction = CompactionStrategy
// resolved.logger = Logger
```

3) **Core accepts concrete instances**:
```ts
const agent = new DextoAgent({
  ...mergedConfig,          // config‑based sections pass through
  storage: resolved.storage,
  tools: resolved.tools,
  plugins: resolved.plugins,
  compaction: resolved.compaction,
  logger: resolved.logger,
});
```

#### `resolveServicesFromConfig` — the new service initializer

This function lives in `@dexto/agent-config` and replaces what `createAgentServices()` does today, but at a higher level. It reads directly from the image's factory maps — plain object property access, no registry classes:

```ts
// In @dexto/agent-config
export async function resolveServicesFromConfig(
  config: MergedAgentConfig,
  image: DextoImageModule,
): Promise<ResolvedServices> {
  return {
    storage: {
      blob: resolveFactory(image.storage, config.storage.blob, 'storage', image.metadata.name),
      database: resolveFactory(image.storage, config.storage.database, 'storage', image.metadata.name),
      cache: resolveFactory(image.storage, config.storage.cache, 'storage', image.metadata.name),
    },
    tools: config.tools.flatMap(toolConfig =>
      resolveFactory(image.tools, toolConfig, 'tools', image.metadata.name)
      // type: 'filesystem-tools' + config → [readFileTool, writeFileTool, ...]
    ),
    plugins: await Promise.all(
      config.plugins.map(pluginConfig =>
        resolveFactory(image.plugins, pluginConfig, 'plugins', image.metadata.name)
      )
    ),
    compaction: resolveFactory(image.compaction, config.compaction, 'compaction', image.metadata.name),
    logger: createLogger(config.logger),
  };
}

// The core resolution helper — just a property lookup + validation + create
function resolveFactory<T>(
  factories: Record<string, { configSchema: z.ZodSchema; create: (config: unknown, context?: unknown) => T }>,
  config: { type: string; [key: string]: unknown },
  category: string,
  imageName: string,
): T {
  const factory = factories[config.type];
  if (!factory) {
    const available = Object.keys(factories).join(', ');
    throw new DextoValidationError(
      `Unknown ${category} type "${config.type}". ` +
      `Image "${imageName}" provides: [${available}]`
    );
  }
  const validated = factory.configSchema.parse(config);
  return factory.create(validated);
}
```

**No `BaseRegistry` class.** The "registry" is just `image.tools` / `image.storage` / etc. — plain objects that map type strings to factories. The resolver does a property lookup, validates the config, and calls `create()`.

#### StorageManager remains internal
```ts
class StorageManager {
  constructor(
    { blob, cache, database }: { blob: BlobStore; cache: Cache; database: Database },
    logger: Logger,
  ) {
    this.blobStore = blob;
    this.cache = cache;
    this.database = database;
  }
}
```

**Config schema surface checklist (all modules touched by config)**
- `/Users/karaj/Projects/dexto/packages/core/src/agent/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/tools/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/llm/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/context/compaction/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/logger/v2/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/memory/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/plugins/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/resources/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/systemPrompt/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/mcp/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/storage/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/storage/database/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/storage/cache/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/storage/blob/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/prompts/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/telemetry/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/approval/schemas.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/session/schemas.ts`

**Verify (before)**
- `/Users/karaj/Projects/dexto/packages/core/src/agent/DextoAgent.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/utils/service-initializer.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/storage/storage-manager.ts`
- `/Users/karaj/Projects/dexto/packages/core/src/agent/schemas.ts`

**Verify (after) — to implement**
- `/Users/karaj/Projects/dexto/packages/agent-config/src/*` (new resolver + defaults)
- `/Users/karaj/Projects/dexto/packages/core/src/agent/DextoAgent.ts` (constructor surface)
- `/Users/karaj/Projects/dexto/packages/core/src/utils/service-initializer.ts` (moved to agent-config / removed)

---

## 6. Before/After — DextoAgent + CLI

### Before
1) CLI loads config
2) CLI imports image (side‑effect registration)
3) CLI enriches config (paths, plugins)
4) Core resolves config → providers using registries

```ts
const imageModule = await import(imageName);
const enriched = enrichAgentConfig(config, path, {
  bundledPlugins: imageModule.imageMetadata?.bundledPlugins ?? [],
});
const agent = new DextoAgent(enrichedConfig, configPath);
```

### After
1) CLI loads config
2) CLI loads image module (plain object, no side effects)
3) CLI applies image defaults to config (shallow merge, config wins)
4) CLI resolves concrete services from config via `resolveServicesFromConfig(config, image)`
5) Core gets concrete instances (no registries anywhere)

```ts
import { resolveServicesFromConfig, applyImageDefaults } from '@dexto/agent-config';

const image = await loadImage(imageName);  // dynamic import, returns DextoImageModule
const mergedConfig = applyImageDefaults(rawConfig, image.defaults);

const resolved = resolveServicesFromConfig(mergedConfig, image);
const agent = new DextoAgent({
  ...mergedConfig,
  storage: resolved.storage,
  tools: resolved.tools,
  plugins: resolved.plugins,
  logger: resolved.logger,
});
```

---

## 7. Custom agents in external projects

### Config‑only users (current platform experience — preserved)
1. User configures agent via dashboard YAML editor or API
2. Config stored in Supabase `deployed_agents` table
3. Platform uses default image (`@dexto/image-local` or `image-cloud`) + the config
4. No custom code, no git, no build step
5. This is the "WordPress" path — quick, no coding required

### Code users (new image deployment — Next.js → Vercel model)
1. User creates a project with `dexto create-image`
2. Writes custom tools in `tools/`, custom storage in `storage/`, etc.
3. Pushes to GitHub
4. Connects repo to Dexto platform (like connecting a repo to Vercel)
5. Platform builds the image (`dexto-bundle build`)
6. Platform deploys it in a sandbox
7. Agent config references the custom image: `image: 'my-custom-image'`
8. This is the "Next.js on Vercel" path — full power, requires coding

### How both coexist
- Config‑only users never see images. They just configure agents via YAML/dashboard.
- Code users create images that **extend the config vocabulary**. Their custom tools become available as `type: 'my-jira-tool'` in YAML configs.
- The platform handles both: if the agent config references a custom image, it builds/loads it first, then applies the config on top.
- **Images extend the config vocabulary, they don't replace it.** A custom image adds new tool types, storage backends, and plugins that can then be referenced by config. Config remains the user‑facing surface for non‑developers.

### Before
External project:
- `dexto.image.ts` with `register()`
- run bundler, publish image
- CLI imports image by name

### After
External project:
- exports a `DextoImageModule` (plain object with factory maps)
- CLI/platform imports image
- resolver reads from factory maps directly

```ts
import { s3BlobStoreFactory } from './storage/s3.js';
import { myInternalToolsFactory } from './tools/internal-api.js';

const image: DextoImageModule = {
  metadata: { name: 'my-org', version: '1.0.0', description: 'Custom image' },
  defaults: {
    storage: { blob: { type: 's3', bucket: 'my-bucket' } },
  },
  tools: {
    'internal-api': myInternalToolsFactory,
  },
  storage: {
    's3': s3BlobStoreFactory,
  },
  plugins: {},
  compaction: {},
};

export default image;
```

This is more explicit, testable, and type‑safe than the current image system. No registries, no side effects, no `register()` method.

---

## 8. Before/After — Tools

### High‑level goal
Unify `customTools` and `internalTools` into a single `tools` concept. **All tools come from the image.** Core receives a flat `Tool[]` and doesn't distinguish "built‑in" from "custom." No image = no tools. The default image provides sensible defaults.

### Before

Two separate concepts in YAML config + a split inside core:

```yaml
# coding-agent.yml — before
internalTools: [ask_user, search_history, invoke_skill]  # toggle built-ins by name
customTools:                                              # provider-based tools
  - type: filesystem-tools
    allowedPaths: ["."]
  - type: process-tools
```

Core special‑cases internal tools (hardcoded in `InternalToolsProvider`) and resolves custom tools via `customToolRegistry`:

```ts
// InternalToolsProvider — before
// Built-in tools created directly from hardcoded implementations
if (enabledInternalTools.includes('ask_user')) {
    tools.push(createAskUserTool(approvalManager));
}
// Custom tools resolved via global registry
for (const toolConfig of customToolConfigs) {
    const provider = customToolRegistry.get(toolConfig.type);
    tools.push(...provider.create(toolConfig, context));
}
```

**Problems:** Two config fields for the same concept. Built‑in tools hardcoded in core. Can't customize or replace built‑in tools. `customToolRegistry` is a global mutable singleton.

### After

One `tools` field. Everything from image factories. Core sees `Tool[]`.

```yaml
# coding-agent.yml — after
tools:
  - type: builtin-tools
    enabled: [ask_user, search_history, invoke_skill]
  - type: filesystem-tools
    allowedPaths: ["."]
  - type: process-tools
```

Built‑in tools move to a `@dexto/tools-builtins` package (or similar) and become a normal tool factory:

```ts
// @dexto/tools-builtins — the former "internal tools" as a standard ToolFactory
export const builtinToolsFactory: ToolFactory = {
    configSchema: z.object({
        type: z.literal('builtin-tools'),
        enabled: z.array(z.enum([
            'ask_user', 'search_history', 'delegate_to_url',
            'list_resources', 'get_resource', 'invoke_skill',
        ])).optional().describe('Which built-in tools to enable. Omit for all.'),
    }).strict(),

    create(config, context: ToolCreationContext): Tool[] {
        const all: Record<string, () => Tool> = {
            'ask_user':         () => createAskUserTool(context.services.approval),
            'search_history':   () => createSearchHistoryTool(context.services.search),
            'delegate_to_url':  () => createDelegateToUrlTool(),
            'list_resources':   () => createListResourcesTool(context.services.resources),
            'get_resource':     () => createGetResourceTool(context.services.resources),
            'invoke_skill':     () => createInvokeSkillTool(context.services.prompts),
        };
        const enabled = config.enabled ?? Object.keys(all);
        return enabled.map(name => all[name]());
    },
};
```

Image‑local provides all tools (built‑in + external):
```ts
// image-local tools map
tools: {
    'builtin-tools': builtinToolsFactory,        // former "internal tools"
    'filesystem-tools': fileSystemToolsProvider,
    'process-tools': processToolsProvider,
    'todo-tools': todoToolsProvider,
    'plan-tools': planToolsProvider,
    'agent-spawner': agentSpawnerFactory,
},
```

Core just receives the flat list:
```ts
new DextoAgent({
    tools: Tool[],  // [ask_user, search_history, read_file, write_file, run_command, ...]
    // Core doesn't know or care where these came from.
});
```

### `ToolCreationContext` — the contract for tool authors

This is what every tool factory receives. It must expose enough for ANY tool (including former "internals") to be built without importing core internals:

```ts
// Exported from @dexto/core — stable contract for tool authors
interface ToolCreationContext {
    logger: IDextoLogger;

    // Storage primitives (concrete instances)
    storage: {
        blob: BlobStore;
        database: Database;
        cache: Cache;
    };

    // Agent services (exposed as interfaces)
    services: {
        approval: ApprovalService;     // request approvals, elicitation
        search: SearchService;         // search conversation history
        resources: ResourceService;    // list/get blob resources
        prompts: PromptService;        // list/invoke prompts and skills
        mcp: McpService;              // access MCP servers/tools
    };

    // Agent identity (read-only, narrow)
    agent: {
        id: string;
        card: AgentCard;
    };
}
```

**Key design choices:**
- Services are **interfaces**, not concrete classes — tool authors depend on contracts, not implementations
- No `[key: string]: any` escape hatch — every service is explicitly typed
- No full `DextoAgent` reference — prevents circular dependency (agent holds tools, tools hold agent)
- `storage` is provided so tools can persist state (e.g., jira sync, todo lists)

### What a custom tool looks like

```ts
// tools/jira/index.ts — in a custom image
export const provider: ToolFactory = {
    configSchema: z.object({
        type: z.literal('jira-tools'),
        apiKey: z.string(),
        baseUrl: z.string().url(),
        projectId: z.string(),
    }).strict(),

    create(config, context: ToolCreationContext): Tool[] {
        const jiraClient = new JiraClient(config.apiKey, config.baseUrl);

        return [
            {
                id: 'jira_search',
                description: 'Search Jira issues',
                inputSchema: z.object({ query: z.string() }),
                async execute(input) {
                    return jiraClient.search((input as { query: string }).query, config.projectId);
                },
            },
            {
                id: 'jira_create_issue',
                description: 'Create a Jira issue',
                inputSchema: z.object({
                    title: z.string(),
                    description: z.string(),
                    issueType: z.enum(['bug', 'story', 'task']),
                }),
                async execute(input) {
                    return jiraClient.createIssue({ project: config.projectId, ...input as any });
                },
            },
        ];
    },
};
```

---

## 9. Before/After — Plugins

### High‑level goal
Plugins become fully DI. Core receives `DextoPlugin[]` — concrete lifecycle hook objects. Plugin resolution (from config type strings to instances) moves to the resolver layer. Custom image authors can provide plugins the same way they provide tools.

### Before

Two plugin sources in config, resolved inside core via `pluginRegistry`:

```yaml
# coding-agent.yml — before
plugins:
  registry:
    - type: memory-extraction
      extractionModel: claude-haiku
  custom:
    - name: my-plugin
      module: ./plugins/my-plugin.js
```

```ts
// PluginManager.initialize() — before
// Registry plugins resolved via global singleton
for (const registryConfig of registryPlugins) {
    const provider = pluginRegistry.get(registryConfig.type);
    const plugin = provider.create(registryConfig, context);
    this.loadedPlugins.push(plugin);
}
// Custom plugins loaded from file paths
for (const customConfig of customPlugins) {
    const module = await loadPluginModule(customConfig.module);
    this.loadedPlugins.push(module);
}
```

**Problems:** `pluginRegistry` is a global mutable singleton. Two different plugin sources with different resolution paths. Plugin authors can't easily access agent services. `PluginExecutionContext` is narrow (only sessionId, userId, llmConfig, logger).

### After

Plugins are image‑provided factories, same pattern as tools. Core receives `DextoPlugin[]`.

```yaml
# coding-agent.yml — after
plugins:
  - type: memory-extraction
    extractionModel: claude-haiku
  - type: compliance-check
    blockedPatterns: ["SSN", "credit-card"]
```

Image provides plugin factories:
```ts
// image-local plugins map (or a custom image)
plugins: {
    'memory-extraction': memoryExtractionFactory,
    'compliance-check': complianceCheckFactory,
},
```

Resolver creates concrete instances:
```ts
const resolved = resolveServicesFromConfig(mergedConfig, image);
// resolved.plugins = [memoryExtractionPlugin, complianceCheckPlugin]
```

Core receives them directly:
```ts
new DextoAgent({
    plugins: DextoPlugin[],  // concrete instances, no type strings
});
```

### `PluginCreationContext` — the contract for plugin authors

```ts
interface PluginCreationContext {
    logger: IDextoLogger;

    storage: {
        blob: BlobStore;
        database: Database;
        cache: Cache;
    };

    agent: {
        id: string;
        card: AgentCard;
    };
}
```

### What a custom plugin looks like

```ts
// plugins/compliance-check/index.ts — in a custom image
export const provider: PluginFactory = {
    configSchema: z.object({
        type: z.literal('compliance-check'),
        blockedPatterns: z.array(z.string()),
        auditLog: z.boolean().default(true),
    }).strict(),

    create(config, context: PluginCreationContext): DextoPlugin {
        const { logger, storage } = context;

        return {
            async beforeResponse(payload, execContext) {
                for (const pattern of config.blockedPatterns) {
                    if (payload.response.includes(pattern)) {
                        logger.warn(`Blocked pattern detected: ${pattern}`);
                        if (config.auditLog) {
                            await storage.database.query(
                                'INSERT INTO compliance_audit (pattern, session_id, ts) VALUES (?, ?, ?)',
                                [pattern, execContext.sessionId, new Date().toISOString()]
                            );
                        }
                        return { action: 'modify', modifiedResponse: '[Blocked by compliance policy]' };
                    }
                }
                return { action: 'continue' };
            },
        };
    },
};
```

---

## 10. Before/After — Compaction Strategy

### High‑level goal
Compaction becomes DI (code‑based, not config‑based). Core receives a concrete `CompactionStrategy` instance. Custom compaction strategies can be provided via images, enabling users to implement their own context management logic.

### Before

Compaction is config‑driven. Core resolves strategy from `compactionRegistry`:

```yaml
# coding-agent.yml — before
compaction:
  strategy: reactive-overflow
  maxContextPercentage: 80
  targetPercentage: 50
```

```ts
// context/compaction/factory.ts — before
const provider = compactionRegistry.get(config.strategy);
const strategy = provider.create(config);
```

**Problems:** `compactionRegistry` is a global mutable singleton. Can't provide custom compaction strategies without registering into the global registry. No way to inject a completely custom strategy via config.

### After

Image provides compaction factories. Resolver creates the concrete strategy. Core receives `CompactionStrategy`.

```yaml
# coding-agent.yml — after (config unchanged for users)
compaction:
  type: reactive-overflow
  maxContextPercentage: 80
  targetPercentage: 50
```

Image provides compaction factories:
```ts
// image-local
compaction: {
    'reactive-overflow': reactiveOverflowFactory,
    'summary-based': summaryBasedFactory,
},
```

Resolver resolves:
```ts
const strategy = resolveFactory(image.compaction, config.compaction, 'compaction', image.metadata.name);
```

Core receives concrete instance:
```ts
new DextoAgent({
    compaction: CompactionStrategy,  // concrete instance, not config
});
```

### `DextoAgentOptions` surface update

Compaction moves from the "config" column to the "DI" column:

```ts
new DextoAgent({
    // ...
    compaction: CompactionStrategy,  // DI — concrete instance
    // NOT: compaction: { strategy: 'reactive-overflow', ... }
});
```

### What a custom compaction strategy looks like

```ts
// compaction/smart-summary/index.ts — in a custom image
export const provider: CompactionFactory = {
    configSchema: z.object({
        type: z.literal('smart-summary'),
        model: z.string().default('claude-haiku'),
        keepLastN: z.number().default(10),
    }).strict(),

    create(config): CompactionStrategy {
        return {
            async shouldCompact(context) {
                return context.tokenCount > context.maxTokens * 0.8;
            },
            async compact(messages, options) {
                // Keep last N messages, summarize the rest
                const toSummarize = messages.slice(0, -config.keepLastN);
                const toKeep = messages.slice(-config.keepLastN);
                const summary = await summarizeWithLLM(toSummarize, config.model);
                return [{ role: 'system', content: `Previous context: ${summary}` }, ...toKeep];
            },
        };
    },
};
```

---

## 11. Defaults merging strategy

Image defaults are useful — they let an image say "if you don't specify storage, use SQLite by default" so that every agent config doesn't need boilerplate.

**Strategy: shallow merge, config wins.**
- If image default says `storage.blob.type: 'local'` and agent config says `storage.blob.type: 's3'`, the config wins.
- If agent config doesn't specify `storage.blob` at all, the image default is used.
- For arrays (like `customTools`), config replaces the default entirely (no array merging).
- Merging happens in `@dexto/agent-config` via `applyImageDefaults()`, not in core.

---

## 12. Migration approach

**Breaking changes are acceptable.** No compatibility shims.

### Affected packages (in dependency order)
1. `@dexto/core` — constructor changes, remove registries + `BaseRegistry` class, accept concrete instances
2. `@dexto/agent-config` (new) — resolver, defaults merging (no registries — reads from image factory maps)
3. `@dexto/image-bundler` — generate `DextoImageModule` with explicit imports, remove `.toString()`
4. `@dexto/image-local` — rewrite as `DextoImageModule` (hand‑written or bundler)
5. `@dexto/agent-management` — remove config parsing responsibilities
6. `@dexto/cli` — use new resolution flow
7. `@dexto/server` — use new resolution flow
8. `dexto-cloud/apps/platform` — migrate `image-cloud` to `DextoImageModule`, use new resolution flow

### Error experience
When a user's YAML references `type: filesystem-tools` but the image doesn't provide it, the resolver in `@dexto/agent-config` should produce a clear error:
```
Error: Unknown tool type 'filesystem-tools'.
  Available types from image 'image-local': filesystem-tools, process-tools, todo-tools, plan-tools
  Hint: Make sure your image provides this tool factory.
```

This error is generated by the `resolveFactory` helper, which has access to `Object.keys(image.tools)` to list available types.

---

## 13. Platform deployment model

### Config‑only agents (current — no changes)

Platform loads agent config from Supabase, uses the default platform image (`image-cloud`), and creates the agent in‑process. No user code, no sandbox.

```
Request → Platform process → load config from DB → resolveServicesFromConfig(config, imageCloud) → new DextoAgent(resolved) → response
```

### Code‑based agents (new — custom images)

Users deploy custom images (GitHub → platform build → artifact storage). The agent runs in an isolated worker process, with LLM access through the existing Dexto gateway.

```
Request → Platform orchestrator → spawn worker process
  Worker:
    - Has: DEXTO_API_KEY (user's own key), user's own secrets (JIRA_API_KEY, etc.)
    - Does NOT have: platform infrastructure secrets (Supabase keys, etc.)
    - Loads user's built image: import('acme-agent-image')
    - resolveServicesFromConfig(config, userImage)
    - new DextoAgent({ ...config, ...resolved, llm: { provider: 'dexto' } })
    - All LLM calls route through api.dexto.ai/v1 using DEXTO_API_KEY
```

**Why this works:**
- **No secrets exposure**: The `dexto` provider already exists in core. It uses `DEXTO_API_KEY` (the user's own credential) to route through `api.dexto.ai/v1`. The gateway adds real LLM provider keys server‑side. User code never sees platform API keys.
- **BYOK support**: If a user has Bring Your Own Key configured, the gateway resolves their stored keys server‑side. The agent environment doesn't change — still just `DEXTO_API_KEY`.
- **Low cost**: Worker processes (Node.js child_process pool) provide process‑level isolation without the overhead of Docker containers. Sandbox containers are only needed for coding agents that require filesystem/process access.
- **Same gateway path**: This is the same network path CLI users already use with `provider: dexto`. No extra infrastructure.

### How both coexist

The `DextoAgent` constructor is identical in both cases — it always receives concrete instances. The difference is where those instances come from:
- Config‑only: platform image factories produce everything
- Code‑based: user image factories produce custom tools/plugins, platform handles infrastructure (LLM via gateway, storage via platform services)

---

## 14. Zod schema & type derivation strategy

### Current state
- 100+ types derived from Zod schemas via `z.output<typeof Schema>` and `z.input<typeof Schema>`
- `ValidatedAgentConfig` is a single monolithic branded type (`z.output<typeof AgentConfigSchema>`) used by 20+ files
- Manager constructors accept Zod‑derived config types: `StorageManager(ValidatedStorageConfig)`, `ToolManager(ToolPolicies, CustomToolsConfig)`, `SystemPromptManager(ValidatedSystemPromptConfig)`, etc.
- `AgentConfigSchema` composes 15+ sub‑schemas creating 4 levels of nesting

### What stays the same
- **Config‑based surfaces keep Zod schemas and derived types.** LLM, MCP, system prompt, sessions, memories, approval, telemetry, resources, prompts — all untouched. Their schemas stay in `@dexto/core`, their `z.output` types remain the constructor argument types for their managers.
- **`AgentConfigSchema` stays for YAML validation.** The CLI/platform still validates YAML config against this schema. It does NOT go away.

### What changes
- **Core's constructor type splits from `ValidatedAgentConfig`.** Today: `new DextoAgent(ValidatedAgentConfig)`. After: `new DextoAgent(DextoAgentOptions)` where `DextoAgentOptions` is a new interface combining:
  - Config fields for naturally‑config‑driven surfaces (still Zod‑derived where applicable)
  - Concrete instances for DI surfaces: `storage: { blob: BlobStore; database: Database; cache: Cache }`, `tools: Tool[]`, `plugins: Plugin[]`, `logger: IDextoLogger`
- **Storage/tools/plugins Zod schemas move to `@dexto/agent-config`.** The resolver validates config against these schemas before calling factories. Core never sees the config shapes for DI surfaces.
- **`ValidatedAgentConfig` continues to exist** as the output of YAML parsing. The resolver consumes it, extracts DI sections, resolves them into concrete instances, and passes the remainder + instances to `DextoAgentOptions`.

### Type flow (after)
```
YAML → AgentConfigSchema.parse() → ValidatedAgentConfig (full config, Zod‑derived)
  │
  ├─ DI sections extracted by resolver:
  │   config.storage → image.storage[type].create() → BlobStore, Database, Cache
  │   config.customTools → image.tools[type].create() → Tool[]
  │   config.plugins → image.plugins[type].create() → Plugin[]
  │   config.logger → createLogger() → IDextoLogger
  │
  └─ Config sections passed through:
      config.llm, config.mcpServers, config.systemPrompt, config.sessions, etc.
  │
  ▼
DextoAgentOptions = { ...configSections, storage: {...}, tools: [...], plugins: [...], logger: ... }
  │
  ▼
new DextoAgent(DextoAgentOptions)  ← core never sees ValidatedStorageConfig or CustomToolsConfig
```

### Risk: `ValidatedAgentConfig` coupling
Many files import and use `ValidatedAgentConfig` as a pass‑through type. After the split, files in core that currently destructure `config.storage` or `config.customTools` will need to change to accept the DI instances instead. This is the biggest mechanical change in the refactor.

**Files that destructure DI sections from `ValidatedAgentConfig` (must change):**
- `packages/core/src/utils/service-initializer.ts` — creates storage, tools, plugins from config → **deleted/moved**
- `packages/core/src/storage/storage-manager.ts` — accepts `ValidatedStorageConfig` → accepts concrete instances
- `packages/core/src/tools/internal-tools/provider.ts` — resolves tools from `customToolRegistry` → accepts `Tool[]`
- `packages/core/src/plugins/manager.ts` — resolves plugins from `pluginRegistry` → accepts `Plugin[]`

**Files that use config‑only sections (no change needed):**
- `packages/core/src/llm/services/factory.ts` — uses `ValidatedLLMConfig` → stays
- `packages/core/src/mcp/manager.ts` — uses `ValidatedServerConfigs` → stays
- `packages/core/src/systemPrompt/manager.ts` — uses `ValidatedSystemPromptConfig` → stays
- `packages/core/src/session/session-manager.ts` — uses `SessionManagerConfig` → stays
- `packages/core/src/memory/manager.ts` — uses `Database` directly → stays

---

## 15. Summary

- **Core should be DI‑first**: accept concrete storage, tools, plugins, compaction strategy, logger. No config resolution inside core.
- **Unified tools**: `internalTools` + `customTools` merge into a single `tools` concept. All tools come from the image. Former "internal" tools move to `@dexto/tools-builtins` (or similar) as a standard `ToolFactory`. Core receives `Tool[]` and doesn't distinguish origins.
- **Unified plugins**: `plugins.registry` + `plugins.custom` merge into a single `plugins` list. All plugins come from image factories. Core receives `DextoPlugin[]`.
- **Compaction is DI**: Core receives a concrete `CompactionStrategy` instance. Custom strategies are provided via image factories, same pattern as tools/plugins.
- **LLM stays config‑based**: Schemas, registry, factory, and resolver all stay in core. No changes needed for the DI refactor.
- **Product layer owns config**: CLI/platform parse, merge defaults, and resolve via `@dexto/agent-config`.
- **Images remain**, but as **typed `DextoImageModule` objects** with plain `Record<string, Factory>` maps for each extension point (tools, storage, plugins, compaction).
- **No registries anywhere.** The image object IS the lookup table. `BaseRegistry` class is removed entirely. The resolver does plain property access: `image.tools[config.type]`.
- **Two ways to build images**: convention‑based (bundler generates object literal from folders) or hand‑written (for re‑exports or full control). Both produce the same `DextoImageModule` interface.
- **Bundler emits explicit imports** into a plain object — no `.toString()`, no duck‑typing, no `register()` calls.
- **Defaults are applied** via shallow merge in the resolver layer, config wins.
- **Breaking changes are fine** — no compatibility shims needed.
- **Platform code‑based agents** run in worker processes with `DEXTO_API_KEY` for LLM access via the existing gateway. No platform secrets exposed.
- **Convention folder configurability and `include` shorthand are future enhancements** — ship with fixed conventions first.
- **YAML UX unchanged**: Users still write `type: filesystem-tools` in config. The difference is that core no longer resolves type strings — the resolver layer does, using the image's factory maps.

This preserves CLI UX while cleaning architecture, increasing type safety, and enabling both config‑based and code‑based agent customization paths.

---

## 16. Tasklist

### Phase 0: Foundation — new package + core interfaces
> **Goal:** Establish the new package and define the target types before changing anything.

- [ ] **0.1 Create `@dexto/agent-config` package skeleton**
  - `packages/agent-config/package.json`, `tsconfig.json`, `src/index.ts`
  - Add to pnpm workspace, turbo pipeline, `.changeset/config.json` fixed array
  - Exit: package builds with `pnpm run build`, exports nothing yet

- [ ] **0.2 Define `DextoImageModule` interface + factory types**
  - `packages/agent-config/src/image/types.ts`
  - `DextoImageModule`, `ToolFactory`, `StorageFactory`, `PluginFactory`, `CompactionFactory`
  - Zero `any` types. Use `unknown` + Zod for validation. Factory `create()` signatures use typed `context` params, not `any`
  - Exit: types compile, can be imported from `@dexto/agent-config`

- [ ] **0.3 Define `DextoAgentOptions` interface in core**
  - New type in `packages/core/src/agent/types.ts` (or similar)
  - Combines config fields (Zod‑derived, for LLM/MCP/sessions/etc.) + DI instances (`storage`, `tools: Tool[]`, `plugins: Plugin[]`, `logger: IDextoLogger`)
  - This is the NEW constructor type. `ValidatedAgentConfig` stays for YAML validation but is no longer the constructor arg.
  - Exit: type compiles, documents every field with JSDoc

- [ ] **0.4 Define core interfaces for DI surfaces (if not already clean)**
  - Verify `BlobStore`, `Database`, `Cache`, `Tool` (InternalTool), `Plugin`, `IDextoLogger` interfaces exist and are clean (no `any`, no config coupling)
  - If any are missing or config‑coupled, define them
  - Exit: all DI surface interfaces are importable from `@dexto/core` with zero `any`

---

### Phase 1: Core accepts DI instances (the big refactor)
> **Goal:** Make core's constructor and internal wiring accept concrete instances instead of resolving from config.
> **This is the highest‑risk phase.** Every subtask should end with `pnpm run build && pnpm test` passing.
> **Every sub‑module in `packages/core/src/` must be vetted.** The tasks below are ordered by dependency: infrastructure first, then modules that depend on them, then the agent shell, then cleanup.

#### 1A — Storage layer (`packages/core/src/storage/`)

- [ ] **1.1 `storage/blob/` — decouple from registry**
  - Files: `registry.ts` (59 lines), `factory.ts` (55 lines), `provider.ts`, `providers/local.ts`, `providers/memory.ts`, `local-blob-store.ts`, `memory-blob-store.ts`, `schemas.ts`, `types.ts`, `index.ts`
  - `factory.ts` calls `blobStoreRegistry.validateConfig()` + `.get()` → remove this path from core. Factory moves to resolver or is deleted.
  - `providers/local.ts` and `providers/memory.ts` auto‑register in `index.ts` → remove auto‑registration, keep as plain exports
  - `registry.ts` + `registry.test.ts` → delete
  - `schemas.ts` (provider config schemas: `LocalBlobStoreSchema`, `InMemoryBlobStoreSchema`) → stay, but move usage to resolver layer
  - `types.ts` (`BlobStore` interface, `BlobStoreProvider` type) → `BlobStore` interface stays in core, `BlobStoreProvider` type may move to agent‑config
  - Exit: zero registry imports in `storage/blob/`. `BlobStore` interface clean. Build + tests pass.

- [ ] **1.2 `storage/database/` — decouple from registry**
  - Files: `registry.ts` (59 lines), `factory.ts` (57 lines), `providers/in-memory.ts`, `providers/sqlite.ts`, `providers/postgres.ts`, `schemas.ts`, `types.ts`, `index.ts`
  - Same pattern as blob: remove factory → registry path, remove auto‑registration, delete registry
  - `Database` interface stays in core
  - Exit: zero registry imports in `storage/database/`. Build + tests pass.

- [ ] **1.3 `storage/cache/` — decouple from registry**
  - Files: `registry.ts` (59 lines), `factory.ts` (55 lines), `providers/in-memory.ts`, `providers/redis.ts`, `schemas.ts`, `types.ts`, `index.ts`
  - Same pattern as blob/database
  - `Cache` interface stays in core
  - Exit: zero registry imports in `storage/cache/`. Build + tests pass.

- [ ] **1.4 `storage/storage-manager.ts` — accept concrete instances**
  - Change constructor from `(config: ValidatedStorageConfig, logger)` to `({ blob, database, cache }, logger)`
  - Remove calls to `createBlobStore()`, `createDatabase()`, `createCache()`
  - `storage-manager.ts` should only orchestrate access to the three backends, not create them
  - Update `storage/index.ts` barrel exports (remove registry re‑exports)
  - Exit: `StorageManager` has zero config‑resolution logic. Build + all storage tests pass.

#### 1B — Tools layer (`packages/core/src/tools/`)

- [ ] **1.5 `tools/custom-tool-registry.ts` — mark for deletion**
  - `CustomToolRegistry` (160 lines) + `custom-tool-schema-registry.ts` → will be deleted in 1.10
  - First: identify all importers within core (internal‑tools/provider.ts, tool-manager.ts, schemas.ts, index.ts)
  - Exit: dependency map documented.

- [ ] **1.6 `tools/internal-tools/provider.ts` — accept concrete `Tool[]`**
  - `InternalToolsProvider.registerCustomTools()` calls `customToolRegistry.validateConfig()` + `.get()` + `provider.create()` → remove entirely
  - After: custom tools arrive as pre‑resolved `Tool[]`, no registry lookup needed
  - `InternalToolsProvider` still manages built‑in tools (ask_user, search_history, etc.) — those stay
  - `tools/internal-tools/registry.ts` (internal tool registry) — vet if this is separate from custom tool registry
  - Update `provider.test.ts`
  - Exit: `InternalToolsProvider` has zero imports from `customToolRegistry`. Build + tests pass.

- [ ] **1.7 `tools/tool-manager.ts` — accept `Tool[]` for custom tools**
  - Currently receives `CustomToolsConfig` (Zod type) and passes to `InternalToolsProvider`
  - After: receives `Tool[]` directly, passes to internal tools provider as pre‑resolved tools
  - Vet: `tool-call-metadata.ts`, `bash-pattern-utils.ts`, `display-types.ts`, `errors.ts`, `types.ts`, `schemas.ts` — assess if any reference registries
  - Vet: `tools/confirmation/` subfolder (allowed‑tools‑provider) — likely no registry dependency, but verify
  - Update `tool-manager.test.ts`, `tool-manager.integration.test.ts`
  - Exit: `ToolManager` has zero registry imports. Build + tests pass.

#### 1C — Plugins layer (`packages/core/src/plugins/`)

- [ ] **1.8 `plugins/manager.ts` — accept concrete `Plugin[]`**
  - `PluginManager.initialize()` currently uses `pluginRegistry.get()` for registry plugins → remove
  - After: receives pre‑resolved `Plugin[]`
  - Vet: `loader.ts` (loads plugins from file paths) — may stay for custom file‑based plugins OR move to resolver
  - Vet: `builtins/content-policy.ts`, `builtins/response-sanitizer.ts` — how are built‑in plugins registered? Via `registrations/builtins.ts` → may need adjustment
  - Vet: `registry.ts` (142 lines) → mark for deletion
  - Vet: `schemas.ts` (`RegistryPluginConfigSchema`, `PluginsConfigSchema`) → stay for YAML validation, move usage to resolver
  - Vet: `types.ts` — `Plugin` interface must be clean for DI
  - Update `registry.test.ts` (delete), `manager.ts` tests
  - Exit: `PluginManager` has zero registry imports. Built‑in plugins registered directly. Build + tests pass.

#### 1D — Context / Compaction (`packages/core/src/context/`)

- [ ] **1.9 `context/compaction/` — decouple from registry**
  - Files: `registry.ts` (32 lines), `factory.ts`, `provider.ts`, `providers/reactive-overflow-provider.ts`, `strategies/`, `schemas.ts`, `types.ts`
  - `factory.ts` calls `compactionRegistry.get()` → remove from core
  - Compaction strategy selection moves to resolver: `image.compaction[config.type].create()`
  - `CompactionConfigSchema` stays in core (compaction config is data)
  - Core receives a concrete `CompactionStrategy` (or continues to select from built‑in strategies via config — clarify)
  - Vet: `overflow.ts`, `strategies/` — these are internal implementations, likely no registry dependency
  - Vet: `context/media-helpers.ts`, `context/types.ts` — unrelated to registries, verify
  - Exit: `context/compaction/` has zero registry imports. Build + tests pass.

#### 1E — Agent shell + service initializer (`packages/core/src/agent/`, `utils/`)

- [ ] **1.10 `agent/DextoAgent.ts` — constructor accepts `DextoAgentOptions`**
  - Change constructor from `(config: AgentConfig, configPath?, options?)` to `(options: DextoAgentOptions)`
  - `DextoAgentOptions` includes concrete storage, tools, plugins, logger + config sections for LLM/MCP/sessions/etc.
  - Remove `serviceOverrides` / `InitializeServicesOptions` pattern
  - Vet: `agent/state-manager.ts` — uses `ValidatedAgentConfig` for state tracking. Assess if it can use a subset type or `DextoAgentOptions`.
  - Vet: `agent/schemas.ts` — `AgentConfigSchema` stays for validation, `AgentConfig` / `ValidatedAgentConfig` types stay but are no longer the constructor arg
  - Vet: `agent/types.ts` — existing types, may need `DextoAgentOptions` added here
  - Vet: `agent/errors.ts`, `agent/error-codes.ts` — likely no changes
  - Vet: `agent/agentCard.ts` — likely no changes
  - Exit: constructor compiles with new type. Callers outside core will break (expected — fixed in Phase 4).

- [ ] **1.11 `utils/service-initializer.ts` — rewrite**
  - Currently 316 lines creating all services from config
  - After: most creation moves to resolver layer. What remains is **internal wiring** that can't move:
    - `SearchService(database, logger)` — uses resolved database
    - `MemoryManager(database, logger)` — uses resolved database
    - `MCPManager` + `initializeFromConfig()` — uses config (MCP stays config‑driven)
    - `ApprovalManager` — uses config (policies are data)
    - `ResourceManager` — uses MCP manager + config
    - `SessionManager` — wires together all other services
    - `SystemPromptManager` — uses config + memory manager
  - May rename to `initializeInternalServices()` with a reduced signature
  - Exit: no registry imports. Takes DI instances + config, wires internal dependencies only. Build passes.

#### 1F — Remaining core sub‑modules (vet for registry/config coupling)

Each of these sub‑modules must be checked for registry imports or tight coupling to `ValidatedAgentConfig` fields that are becoming DI. Most should require NO changes, but must be verified.

- [ ] **1.12 `llm/` — vet (expect: no changes)**
  - LLM stays config‑driven (`ValidatedLLMConfig`). No registries involved (LLM registry is model metadata, not a provider registry).
  - Vet: `services/factory.ts` (creates Vercel model from config — stays), `services/vercel.ts`, `executor/turn-executor.ts`
  - Vet: `llm/registry/` — this is the MODEL registry (model names, pricing, capabilities). Completely separate from provider registries. Stays as‑is.
  - Vet: `llm/providers/local/` — local model provider. Verify no provider registry dependency.
  - Vet: `llm/formatters/` — message formatting. Likely no changes.
  - Vet: `llm/validation.test.ts`, `llm/schemas.ts` — stay
  - Vet: How do we currently handle LLM config validation and LLM switching. What needs to move out of core here?
  - Exit: confirmed no registry imports in `llm/`. No changes needed. Document.

- [ ] **1.13 `mcp/` — vet (expect: no changes)**
  - MCP stays config‑driven. `MCPManager` constructor takes `logger`, `initializeFromConfig()` takes `ValidatedServerConfigs`.
  - Vet: `manager.ts`, `mcp-client.ts`, `resolver.ts`, `schemas.ts`, `types.ts`
  - Exit: confirmed no registry imports in `mcp/`. No changes needed. Document.

- [ ] **1.14 `session/` — vet (expect: minimal changes)**
  - `SessionManager` constructor takes services + config. Services come from service initializer.
  - After: services come from `DextoAgentOptions` → internal wiring.
  - Vet: `session-manager.ts`, `chat-session.ts`, `history/database.ts`, `history/factory.ts`, `history/memory.ts`
  - Vet: does `history/factory.ts` use a registry? If so, decouple.
  - Vet: `schemas.ts` — `SessionConfigSchema` stays
  - Exit: confirmed no registry imports. Session types compatible with new wiring.

- [ ] **1.15 `memory/` — vet (expect: no changes)**
  - `MemoryManager(database, logger)` — already takes concrete `Database` instance.
  - Vet: `manager.ts`, `schemas.ts`, `types.ts`
  - Exit: confirmed no changes needed. Already DI‑compatible.

- [ ] **1.16 `systemPrompt/` — vet (expect: no changes)**
  - `SystemPromptManager(config, configDir, memoryManager, memoriesConfig, logger)` — takes config (data) + concrete memory manager.
  - Vet: `manager.ts`, `contributors.ts`, `in-built-prompts.ts`, `registry.ts` (is this a provider registry? Investigate), `schemas.ts`
  - **Risk:** `systemPrompt/registry.ts` — name suggests a registry pattern. Must investigate whether it's a provider registry or just a contributor registry (internal).
  - Exit: confirmed no provider registry dependency. Document any internal registries.

- [ ] **1.17 `approval/` — vet (expect: no changes)**
  - `ApprovalManager` takes config (policies are data).
  - Vet: `manager.ts`, `factory.ts`, `schemas.ts`, `types.ts`
  - Exit: confirmed no registry imports. No changes.

- [ ] **1.18 `search/` — vet (expect: no changes)**
  - `SearchService(database, logger)` — already takes concrete `Database`.
  - Vet: all files in `search/`
  - Exit: confirmed no changes.

- [ ] **1.19 `resources/` — vet (expect: no changes)**
  - `ResourceManager` takes MCP manager + config.
  - Vet: `internal-provider.ts`, `handlers/`, `schemas.ts`
  - Exit: confirmed no registry imports.

- [ ] **1.20 `prompts/` — vet (expect: no changes)**
  - `PromptManager` handles prompt loading from config + MCP.
  - Vet: `prompt-manager.ts`, `providers/config-prompt-provider.ts`, `providers/custom-prompt-provider.ts`, `providers/mcp-prompt-provider.ts`, `schemas.ts`
  - Exit: confirmed no registry imports.

- [ ] **1.21 `logger/` — vet (expect: DI change)**
  - Logger becomes a DI instance. Core receives `IDextoLogger`, doesn't create it from config.
  - Vet: `logger.ts` (v1), `v2/` (v2 logger system — 10 files). Understand which is used.
  - `LoggerConfigSchema` stays for config validation (in resolver layer).
  - Logger creation (`createLogger(config)`) moves to resolver.
  - Exit: core uses `IDextoLogger` interface only. No logger creation from config in core.

- [ ] **1.22 `telemetry/` — vet (expect: minimal changes)**
  - Telemetry is config‑driven (`OtelConfigurationSchema`).
  - Vet: `telemetry.ts`, `decorators.ts`, `exporters.ts`, `utils.ts`, `schemas.ts`
  - Telemetry init currently happens in service initializer — may stay in internal wiring or move to resolver
  - Exit: document decision. Confirm no registry dependency.

- [ ] **1.23 `events/` — vet (expect: no changes)**
  - `AgentEventBus` is created early in DextoAgent constructor. No config dependency.
  - Vet: `index.ts`
  - Exit: confirmed no changes.

- [ ] **1.24 `errors/` — vet (expect: no changes)**
  - Error infrastructure. No config or registry dependency.
  - Exit: confirmed no changes.

- [ ] **1.25 `utils/` — vet remaining utilities**
  - `service-initializer.ts` → covered in 1.11
  - Vet: `api-key-resolver.ts` — resolves API keys from env. Likely no changes.
  - Vet: `execution-context.ts` — detects dexto‑source vs project vs global. May need update if path resolution changes.
  - Vet: `schema-metadata.ts`, `zod-schema-converter.ts` — schema utilities. Likely no changes.
  - Vet: `path.ts`, `env.ts`, `fs-walk.ts`, `debug.ts`, `defer.ts`, `result.ts`, `safe-stringify.ts`, `redactor.ts`, `user-info.ts`, `async-context.ts`, `error-conversion.ts` — general utilities. No registry dependency.
  - Exit: all utils vetted. Only `service-initializer.ts` changes.

- [ ] **1.26 `providers/` — delete registry infrastructure**
  - `base-registry.ts` (208 lines) — base class for all registries → delete
  - `base-registry.test.ts` → delete
  - `discovery.ts` (178 lines) — `listAllProviders()`, `hasProvider()` — queries all registries → delete
  - `discovery.test.ts`, `discovery.integration.test.ts` → delete
  - Vet: any other files in `providers/` — `index.ts` barrel exports
  - Exit: `providers/` directory deleted or emptied. Build passes.

- [ ] **1.27 `image/` — remove old image infrastructure from core**
  - `define-image.ts` (213 lines) → delete
  - `types.ts` (old `ImageDefinition`, `ImageProvider`, etc.) → delete
  - `index.ts` → delete
  - `DextoImageModule` now lives in `@dexto/agent-config`
  - Exit: `packages/core/src/image/` directory deleted. No image exports from core.

- [ ] **1.28 `index.ts` barrel — remove deleted exports**
  - Remove: all registry exports (`customToolRegistry`, `blobStoreRegistry`, `databaseRegistry`, `cacheRegistry`, `pluginRegistry`, `compactionRegistry`, `BaseRegistry`)
  - Remove: `listAllProviders`, `hasProvider` from providers
  - Remove: `defineImage` and image types
  - Keep: all interface exports (`BlobStore`, `Database`, `Cache`, `Tool`, `Plugin`, `IDextoLogger`, etc.)
  - Keep: all config‑driven exports (schemas, LLM types, MCP types, etc.)
  - Vet: `index.browser.ts` — browser‑safe exports subset. Remove registry exports here too.
  - Exit: `packages/core/src/index.ts` has zero registry exports. Build + all downstream packages compile.

- [ ] **1.29 Final validation — all registries gone from core**
  - `rg 'Registry' packages/core/src/ --type ts` → only LLM model registry (legitimate, not a provider registry)
  - `rg 'registry' packages/core/src/ --type ts -i` → audit remaining hits
  - `pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck` → all pass
  - Exit: core is registry‑free. All quality checks pass.

---

### Phase 2: Build the resolver (`@dexto/agent-config`)
> **Goal:** The new package can take a `ValidatedAgentConfig` + `DextoImageModule` and produce a `DextoAgentOptions`.

- [ ] **2.1 `applyImageDefaults(config, imageDefaults)`**
  - Shallow merge implementation. Config wins. Arrays replace, don't merge.
  - Unit tests with various merge scenarios
  - Exit: function works, tests pass, handles edge cases (missing defaults, missing config sections)

- [ ] **2.2 `resolveServicesFromConfig(config, image)`**
  - Implements the factory resolution: `image.tools[config.type]` → validate → create
  - Handles tool grouping (one factory → `Tool[]`)
  - Handles storage resolution (blob, database, cache)
  - Handles plugin resolution
  - Handles compaction resolution
  - Creates logger from config
  - Produces `ResolvedServices` object
  - Exit: unit tests with mock image + mock config produce correct concrete instances. Error cases tested (unknown type, validation failure).

- [ ] **2.3 `loadImage(imageName)` helper**
  - Dynamic import wrapper that returns `DextoImageModule`
  - Validates the imported module conforms to `DextoImageModule` shape (runtime check)
  - Clear error if import fails or shape doesn't match
  - Exit: can load `@dexto/image-local` (once rewritten) and return typed module

- [ ] **2.4 Move storage factory functions to agent‑config**
  - `createBlobStore()`, `createDatabase()`, `createCache()` — these use registries today
  - After: they're no longer needed as standalone functions. The resolver calls `image.storage[type].create()` directly.
  - If any other code uses them, provide them in agent‑config as convenience wrappers
  - Exit: factory functions removed from core or re‑exported from agent‑config only

- [ ] **2.5 Move/keep `AgentConfigSchema` for validation**
  - Decision: does `AgentConfigSchema` stay in core (it defines the shape) or move to agent‑config (it's a config concern)?
  - Recommendation: keep in core since many sub‑schemas reference core types. But `resolveServicesFromConfig` lives in agent‑config.
  - Exit: clear ownership. Schema validates. Resolver consumes validated output.

---

### Phase 3: Image system rewrite
> **Goal:** Images export `DextoImageModule` objects. No side effects, no `.toString()`, no registries.

- [ ] **3.1 Rewrite `@dexto/image-local` as hand‑written `DextoImageModule`**
  - Delete `dexto.image.ts` + bundler‑generated output
  - Write `index.ts` exporting `DextoImageModule` with factory maps
  - Import tool providers from `@dexto/tools-filesystem`, `@dexto/tools-process`, etc.
  - Import storage factories from core (or new locations)
  - Verify existing tool providers (`fileSystemToolsProvider`, etc.) conform to `ToolFactory` interface — adapt if needed
  - Exit: `import imageLocal from '@dexto/image-local'` returns typed `DextoImageModule`. No side effects on import. Build passes.

- [ ] **3.2 Adapt existing tool provider packages**
  - `@dexto/tools-filesystem`, `@dexto/tools-process`, `@dexto/tools-todo`, `@dexto/tools-plan`
  - Each currently exports a `CustomToolProvider<Type, Config>` — verify it matches `ToolFactory` or create adapter
  - Remove `customToolRegistry.register()` calls if any exist
  - Exit: each tool package exports a `ToolFactory`‑compatible object. No registry imports.

- [ ] **3.3 Adapt storage providers in core**
  - `localBlobStoreProvider`, `inMemoryBlobStoreProvider`, `sqliteProvider`, `postgresProvider`, `inMemoryCacheProvider`, `redisCacheProvider`
  - These currently register themselves as side effects in their `index.ts` barrel files
  - Remove auto‑registration. Export providers as `StorageFactory`‑compatible objects only.
  - Exit: no storage provider self‑registers. Each is a plain exported object.

- [ ] **3.4 Update `@dexto/image-bundler`**
  - Generate `DextoImageModule` object literal with explicit imports (not `register()` calls)
  - Folder name → type string mapping (`tools/jira/` → key `'jira'`)
  - Remove `.toString()` serialization logic entirely
  - Remove duck‑typing discovery — require explicit `export const provider` contract
  - Exit: bundler generates valid `DextoImageModule`. Can bundle a test image with convention folders.

- [ ] **3.5 Remove old image infrastructure from core**
  - Delete `packages/core/src/image/define-image.ts`
  - Delete `packages/core/src/image/types.ts` (old `ImageDefinition`, `ImageProvider`, etc.)
  - Remove image exports from `packages/core/src/index.ts`
  - `DextoImageModule` lives in `@dexto/agent-config` now
  - Exit: `rg 'defineImage' packages/core/` returns zero results. Build passes.

---

### Phase 4: CLI + Server integration
> **Goal:** CLI and server use the new resolution flow. End‑to‑end agent startup works.

- [ ] **4.1 Update CLI entry point (`packages/cli/src/index.ts`)**
  - Replace side‑effect image import with `loadImage()` from agent‑config
  - Call `applyImageDefaults()` + `resolveServicesFromConfig()` before creating `DextoAgent`
  - Remove `imageMetadata?.bundledPlugins` pattern — bundled plugins are now in `image.defaults` or resolved directly
  - Exit: `dexto` CLI starts successfully with `@dexto/image-local`. Chat works end‑to‑end.

- [ ] **4.2 Update CLI server mode (`packages/cli/src/api/server-hono.ts`)**
  - Agent switching (`createAgentFromId()`) uses new resolution flow
  - Exit: `dexto serve` starts, can switch agents, chat works.

- [ ] **4.3 Update `@dexto/server` if needed**
  - Server receives `DextoAgent` instance — may need minimal changes
  - Verify `startDextoServer(agent)` still works with new agent shape
  - Exit: server package builds and integration tests pass.

- [ ] **4.4 Update `@dexto/agent-management` config enrichment**
  - `enrichAgentConfig()` may need updates for the new flow
  - Remove any config parsing responsibilities that moved to agent‑config
  - Exit: config enrichment works with new resolution flow. Build + tests pass.

- [ ] **4.5 End‑to‑end smoke test**
  - Start CLI with default image → chat with agent → tools work (filesystem, process)
  - Start server mode → API calls work
  - Switch agents → works
  - Exit: manual smoke test passes. All CI checks green (`pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck`).

---

### Phase 5: Cleanup + testing
> **Goal:** Remove all dead code, fix all broken tests, add new tests.

- [ ] **5.1 Delete dead registry code**
  - All `*Registry` classes, singleton instances, factory functions that used registries
  - `providers/discovery.ts` (unless we want a non‑registry version)
  - Registry test files
  - Exit: no dead code. `pnpm run build` clean.

- [ ] **5.2 Update all broken tests**
  - Tests that mock registries → mock image factory maps instead
  - Tests that test registry behavior → delete or convert to resolver tests
  - `DextoAgent.lifecycle.test.ts` → update for new constructor
  - Integration tests → update agent creation
  - Exit: `pnpm test` passes with zero failures.

- [ ] **5.3 Add new test coverage**
  - `resolveServicesFromConfig()` unit tests (happy path, missing type, validation failure, tool grouping)
  - `applyImageDefaults()` unit tests (merge scenarios)
  - `DextoImageModule` conformance tests (type checking, factory contracts)
  - Image‑local unit test (exports valid `DextoImageModule`)
  - Exit: new tests cover resolver, defaults, and image module validation.

- [ ] **5.4 Update documentation**
  - `/docs` — image concept documentation
  - `README.md` for `@dexto/agent-config`, `@dexto/image-local`, `@dexto/image-bundler`
  - Update `AGENTS.md` / `CLAUDE.md` with new architecture
  - Update `.cursor/rules/service_initializer.mdc`
  - Exit: docs reflect new architecture. No references to old registries or `defineImage()`.

- [ ] **5.5 Update OpenAPI / server docs if affected**
  - Run `pnpm run sync-openapi-docs` if any API routes changed
  - Exit: OpenAPI spec up to date.

---

### Phase 6: Platform migration (dexto‑cloud) — separate effort
> **Goal:** Platform uses new resolution flow. Image‑cloud migrated.

- [ ] **6.1 Rewrite `image-cloud` as `DextoImageModule`**
  - Hand‑written, imports Supabase blob provider, scheduler tools, etc.
  - Remove fire‑and‑forget registration
  - Exit: `image-cloud` exports valid `DextoImageModule`.

- [ ] **6.2 Update platform agent creation**
  - `ScopeFactory.createScope()`, `RemoteAgentRegistry`, `AgentRuntime`, `TenantContext`
  - All `new DextoAgent(config)` calls → use resolution flow
  - Exit: platform creates agents with new flow. Existing functionality preserved.

- [ ] **6.3 Platform deployment model for code‑based agents**
  - Worker process pool + `DEXTO_API_KEY` gateway model
  - Image build pipeline (GitHub → build → artifact storage)
  - This is a larger feature, likely its own plan
  - Exit: design documented, not necessarily implemented in this phase.

---

### Dependency order
```
Phase 0 (foundation) → Phase 1 (core DI) → Phase 2 (resolver) → Phase 3 (images)
                                                                       ↓
                                                                 Phase 4 (CLI/server)
                                                                       ↓
                                                                 Phase 5 (cleanup)
                                                                       ↓
                                                                 Phase 6 (platform)
```

**Phases 1 and 2 can partially overlap:** as each core module is decoupled (1.1, 1.2, 1.3), the corresponding resolver section (2.2) can be built to exercise it.

**Estimated blast radius:**
- ~80 files import from registries → all need updating
- ~20 files import `ValidatedAgentConfig` for constructor paths → need `DextoAgentOptions`
- ~15 test files test registry behavior → delete or rewrite
- ~6 registry classes + 6 singleton instances → all deleted
- 1 service initializer (316 lines) → rewritten/moved
- 1 `DextoAgent.ts` (2869 lines) → constructor + `start()` significantly changed
- 2 image packages → rewritten
- 1 image bundler → `.toString()` logic removed, generates new output format
