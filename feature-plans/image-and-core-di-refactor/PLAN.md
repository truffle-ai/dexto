# Image + Core DI Refactor Plan

This plan captures the current problems, the target architecture, and concrete before/after behavior with code snippets. It is written to preserve the current CLI UX while making core DI‑friendly and fixing the image system.

**Working memory:** [`WORKING_MEMORY.md`](./WORKING_MEMORY.md) is a colocated scratchpad that agents should actively update while working through this plan. It tracks the current task, decisions made, blockers, and progress. **Read it before starting work. Update it after each task.**

**Owner verification list:** [`USER_VERIFICATION.md`](./USER_VERIFICATION.md) tracks **owner-only** decisions and manual checks that we deliberately defer while implementing. **Add an entry whenever you discover an unresolved decision or a manual verification the owner must do.** Mark entries done when resolved. Phase 5.6 requires this list to be reviewed/cleared before Phase 6 (platform).

**Temporary glue code:** Some “temporary glue code” is expected while we keep the repo building during the refactor. Whenever adding new glue, tag it with:
`// TODO: temporary glue code to be removed/verified (remove-by: <phase.task>)`
Default `remove-by` is **5.1** unless you know it can be removed earlier. **Low-churn backfill:** only add/remove `remove-by` tags when touching the surrounding code; Phase 5.1 is the hard cleanup gate.

---

## 1. Problems

### Coupling + typing issues
- **Core is tightly coupled to config**: `StorageManager` and tool creation resolve providers from config (string `type`) inside core. This requires global registries and makes core dependent on higher‑level configuration concerns.
- **Image layer erases types**: `ImageProvider` and `ImageDefaults` use `any` heavily (`configSchema: z.ZodType<any>`, `create: (config: any, deps: any) => any`, `[key: string]: any` index signatures). The image layer discards the stronger types used by provider packages.
- **Image defaults aren't applied**: image `defaults` exist in definitions but are **not merged into agent config anywhere at runtime**. For example, `defaults.tools` (formerly `defaults.customTools`) in `image-local` is never merged — it's dead metadata. This is a silent bug.
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

## 3. Where this lives (new packages)

We will add **three** new packages as part of this refactor (logger extraction is deferred for now):
- **`@dexto/agent-config`** — config parsing, validation, image default merging, and service resolution
- **`@dexto/storage`** — all storage implementations extracted from core (SQLite, Postgres, local blob, memory, Redis)
- **`@dexto/tools-builtins`** — former "internal" tools (ask_user, search_history, etc.) as a standard `ToolFactory`
- **(Deferred / split) `@dexto/logger`** — extracting logger impl + schemas from core surfaced layering issues (core utilities relied on a global logger), forcing `console.*` fallbacks or wider DI threading. We keep logger in `@dexto/core` for now and revisit extraction later with a clean types-vs-impl split (see Phase 3.3 notes).

This prevents `agent-management` from becoming a mega‑package, makes the DI boundary explicit, and ensures core contains only interfaces and orchestration for the main DI surfaces (storage/tools/plugins/compaction). Logger remains in core for now.

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
  storage: {
    blob: Record<string, BlobStoreFactory>;
    database: Record<string, DatabaseFactory>;
    cache: Record<string, CacheFactory>;
  };
  plugins: Record<string, PluginFactory>;
  compaction: Record<string, CompactionFactory>;
  logger: LoggerFactory;
}

// Tool factory: one config entry can produce multiple tools (grouping)
// create() takes ONLY config — no services. Tools access services at runtime via ToolExecutionContext.
interface ToolFactory {
  configSchema: z.ZodSchema;
  create(config: unknown): Tool[];
  metadata?: { displayName: string; description: string; category: string };
}

// Storage factories: typed per category (prevents putting a sqlite factory in the blob map)
interface BlobStoreFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, logger: IDextoLogger): BlobStore;
}
interface DatabaseFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, logger: IDextoLogger): Database;
}
interface CacheFactory {
  configSchema: z.ZodSchema;
  create(config: unknown, logger: IDextoLogger): Cache;
}

// Plugin factory: create() takes ONLY config — no services. Plugins access services at runtime via hooks.
interface PluginFactory {
  configSchema: z.ZodSchema;
  create(config: unknown): DextoPlugin;
}

interface CompactionFactory {
  configSchema: z.ZodSchema;
  create(config: unknown): CompactionStrategy;
}

interface LoggerFactory {
  configSchema: z.ZodSchema;
  create(config: unknown): IDextoLogger;
}

// Runtime context — provided by ToolManager when tools EXECUTE, not at construction time.
// This is how tools access agent services without creating init ordering cycles.
// Inspired by Mastra's pattern: tools are standalone at construction, services injected per-execution.
interface ToolExecutionContext {
  agent: DextoAgent;        // full agent (narrow to interface later — TODO)
  logger: IDextoLogger;
  storage: {
    blob: BlobStore;
    database: Database;
    cache: Cache;
  };
  services: {
    approval: ApprovalService;
    search: SearchService;
    resources: ResourceService;
    prompts: PromptService;
    mcp: McpService;
  };
}
```

**Why this works:** Config uses type strings (`type: 'filesystem-tools'`). The image provides a plain object mapping those type strings to factories. The resolver does `image.tools[config.type]` — a property access, not a registry lookup. Composing images is just object spread: `{ ...baseImage.tools, ...childImage.tools }`.

**Why factories take only config (no services):** Factories capture **config** in closures (allowedPaths, securityLevel, API keys). Tools access **services** at runtime through `ToolExecutionContext`, which the `ToolManager` provides when a tool executes. This eliminates the init ordering cycle entirely — no two-phase init, no lazy getters, no callbacks. The resolver builds everything independently, then the agent wires runtime context internally.

**Why storage is split into `blob`/`database`/`cache` maps:** A single `Record<string, StorageFactory>` where `create()` returns `BlobStore | Database | Cache` allows type-unsafe mismatches (e.g., putting a sqlite factory in the blob map). Splitting into typed sub-maps catches these errors at compile time.

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
│   └── blob/
│       └── gcs/
│           └── index.ts
└── plugins/
    └── audit-log/
        └── index.ts
```

Convention folders:
- `tools/` — custom tool providers
- `storage/blob/` — blob store backends
- `storage/database/` — database backends
- `storage/cache/` — cache backends
- `plugins/` — lifecycle plugins
- `compaction/` — compaction strategy providers

Each subfolder's `index.ts` exports a named `provider` export (explicit contract, no duck‑typing):
```ts
// tools/jira/index.ts
export const provider: ToolFactory = {
  configSchema: JiraConfigSchema,
  create: (config) => [jiraQueryTool, jiraCreateIssueTool, ...],
  metadata: { displayName: 'Jira Tools', description: '...', category: 'integrations' },
};
```

The bundler discovers these folders, generates **explicit imports into a plain object** (no `.toString()`, no registries):
```ts
// Generated dist/index.js
import { provider as jira } from './tools/jira/index.js';
import { provider as salesforce } from './tools/salesforce/index.js';
import { provider as gcs } from './storage/blob/gcs/index.js';
import { provider as auditlog } from './plugins/audit-log/index.js';
import { defaultLoggerFactory } from '@dexto/core'; // Phase 3.3 deferred; logger stays in core for now
import imageConfig from './dexto.image.js';

const image: DextoImageModule = {
  metadata: imageConfig.metadata,
  defaults: imageConfig.defaults,
  tools: {
    'jira': jira,                // folder name = type string
    'salesforce': salesforce,
  },
  storage: {
    blob: { 'gcs': gcs },
    database: {},
    cache: {},
  },
  plugins: {
    'audit-log': auditlog,
  },
  compaction: {},
  logger: defaultLoggerFactory,
};

export default image;
```

**The folder name becomes the type string used in config.** E.g. `tools/jira/` → `type: 'jira'` in YAML. For storage: `storage/blob/gcs/` → `storage.blob.type: 'gcs'`. Simple, predictable convention.

#### B) Hand‑written (for images that re‑export from external packages or need full control)

For images like `image-local` where providers come from existing `@dexto/*` packages:

```ts
// image-local/index.ts
import { localBlobStoreFactory, inMemoryBlobStoreFactory, sqliteFactory, postgresFactory,
         inMemoryDatabaseFactory, inMemoryCacheFactory, redisCacheFactory } from '@dexto/storage';
import { defaultLoggerFactory } from '@dexto/core'; // Phase 3.3 deferred; logger stays in core for now
import { builtinToolsFactory } from '@dexto/tools-builtins';
import { fileSystemToolsProvider } from '@dexto/tools-filesystem';
import { processToolsProvider } from '@dexto/tools-process';
import { todoToolsProvider } from '@dexto/tools-todo';
import { planToolsProvider } from '@dexto/tools-plan';
import { agentSpawnerToolsProvider } from '@dexto/agent-management';
import { contentPolicyFactory, responseSanitizerFactory } from './plugins/index.js';
import { reactiveOverflowFactory, noopCompactionFactory } from './compaction/index.js';

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
      cache: { type: 'in-memory-cache' },
    },
    tools: [
      { type: 'builtin-tools' },
      { type: 'filesystem-tools', allowedPaths: ['.'], blockedPaths: ['.git', '.env'] },
      { type: 'process-tools', securityLevel: 'moderate' },
      { type: 'todo-tools' },
    ],
    compaction: { type: 'reactive-overflow', maxContextPercentage: 80, targetPercentage: 50 },
  },
  // Plain objects — the image IS the lookup table
  tools: {
    'builtin-tools': builtinToolsFactory,          // former "internal tools" (ask_user, search_history, etc.)
    'filesystem-tools': fileSystemToolsProvider,    // already has configSchema + create()
    'process-tools': processToolsProvider,
    'todo-tools': todoToolsProvider,
    'plan-tools': planToolsProvider,
    'agent-spawner': agentSpawnerToolsProvider,
  },
  storage: {
    blob: { 'local': localBlobStoreFactory, 'in-memory': inMemoryBlobStoreFactory },
    database: { 'sqlite': sqliteFactory, 'postgres': postgresFactory, 'in-memory': inMemoryDatabaseFactory },
    cache: { 'in-memory': inMemoryCacheFactory, 'redis': redisCacheFactory },
  },
  plugins: {
    'content-policy': contentPolicyFactory,         // former built-in plugin
    'response-sanitizer': responseSanitizerFactory,  // former built-in plugin
  },
  compaction: {
    'reactive-overflow': reactiveOverflowFactory,
    'noop': noopCompactionFactory,
  },
  logger: defaultLoggerFactory,
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
    storage: {
      blob: ['@dexto/storage/blob-local'],
      // database/cache omitted for brevity
    },
  },
  defaults: { ... },
});
```

The bundler would generate explicit imports for these alongside convention folder discoveries. **Not required for v1 — document as future enhancement.**

#### Convention folder configurability (future enhancement)

A separate config file (not `dexto.image.ts`) could allow overriding default folder paths, similar to how `next.config.ts` allows `src/` directory. **Not required for v1 — document as future enhancement.** Ship with fixed conventions first (`tools/`, `storage/blob/`, `storage/database/`, `storage/cache/`, `plugins/`, `compaction/`), add configurability when someone actually needs it.

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
| Plugins | **DI** — accept concrete `DextoPlugin[]` | Plugins are lifecycle hooks = code |
| Logger | **DI** — accept concrete `IDextoLogger` instance | Logger is a service |
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
  plugins: DextoPlugin[],

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
- **`plugins` is a flat `DextoPlugin[]`** — same principle.
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
// resolved.plugins = DextoPlugin[]
// resolved.compaction = CompactionStrategy
// resolved.logger = IDextoLogger
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

This function lives in `@dexto/agent-config` and replaces what `createAgentServices()` does today, but at a higher level. It reads directly from the image's factory maps — plain object property access, no registry classes.

**Key design: no init ordering cycles.** Factories receive only config (not agent services). Tools/plugins access services at runtime via `ToolExecutionContext` provided by the agent's `ToolManager`. This means every resolution step is independent — no two-phase init, no lazy getters, no callbacks.

```ts
// In @dexto/agent-config
export function resolveServicesFromConfig(
  config: MergedAgentConfig,
  image: DextoImageModule,
): ResolvedServices {
  // Logger first — storage factories may need it for internal logging
  const logger = resolveSingletonFactory(image.logger, config.logger, 'logger', image.metadata.name);

  // Storage — typed per category (blob/database/cache maps prevent mismatches)
  const storage = {
    blob: resolveFactory(image.storage.blob, config.storage.blob, 'storage.blob', image.metadata.name, logger),
    database: resolveFactory(image.storage.database, config.storage.database, 'storage.database', image.metadata.name, logger),
    cache: resolveFactory(image.storage.cache, config.storage.cache, 'storage.cache', image.metadata.name, logger),
  };

  // Tools — factories take ONLY config (no services). Tools access services at runtime.
  const tools = config.tools.flatMap(toolConfig =>
    resolveFactory(image.tools, toolConfig, 'tools', image.metadata.name)
    // type: 'filesystem-tools' + config → [readFileTool, writeFileTool, ...]
    // type: 'builtin-tools' + config → [ask_user, search_history, ...]
  );

  // Plugins — same pattern as tools. Config only, services at runtime.
  const plugins = config.plugins.map(pluginConfig =>
    resolveFactory(image.plugins, pluginConfig, 'plugins', image.metadata.name)
  );

  // Compaction — pure config, no services needed
  const compaction = resolveFactory(image.compaction, config.compaction, 'compaction', image.metadata.name);

  return { logger, storage, tools, plugins, compaction };
}

// The core resolution helper — property lookup + validation + create
function resolveFactory<T>(
  factories: Record<string, { configSchema: z.ZodSchema; create: (config: unknown, ...args: unknown[]) => T }>,
  config: { type: string; [key: string]: unknown },
  category: string,
  imageName: string,
  ...args: unknown[]
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
  return factory.create(validated, ...args);
}

// Logger helper — validate + create (no type string lookup)
function resolveSingletonFactory<T>(
  factory: { configSchema: z.ZodSchema; create: (config: unknown) => T },
  config: unknown,
  category: string,
  imageName: string,
): T {
  try {
    const validated = factory.configSchema.parse(config);
    return factory.create(validated);
  } catch (err) {
    throw new DextoValidationError(
      `Invalid ${category} config for image "${imageName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
```

**No `BaseRegistry` class.** The "registry" is just `image.tools` / `image.storage` / etc. — plain objects that map type strings to factories. The resolver does a property lookup, validates the config, and calls `create()`.

**No init ordering problem.** The resolver doesn't need the `DextoAgent` instance. Everything resolves independently in a flat top-to-bottom flow: logger → storage → tools → plugins → compaction. The agent constructs its internal services (`ApprovalManager`, `SearchService`, etc.) in its own constructor and builds a `ToolExecutionContext` that the `ToolManager` provides to tools at runtime.

#### StorageManager remains internal
```ts
class StorageManager {
  constructor(
    { blob, cache, database }: { blob: BlobStore; cache: Cache; database: Database },
    logger: IDextoLogger,
  ) {
    this.blobStore = blob;
    this.cache = cache;
    this.database = database;
  }
}
```

**Config schema surface checklist**

Schemas that **stay in core** (config‑based surfaces, core managers need these):
- `packages/core/src/llm/schemas.ts` — `LLMConfigSchema`, `ValidatedLLMConfig`
- `packages/core/src/mcp/schemas.ts` — `McpServersConfigSchema`
- `packages/core/src/systemPrompt/schemas.ts` — `SystemPromptConfigSchema`
- `packages/core/src/session/schemas.ts` — `SessionConfigSchema`
- `packages/core/src/memory/schemas.ts` — `MemoriesConfigSchema`
- `packages/core/src/approval/schemas.ts` — `ToolConfirmationConfigSchema`, `ElicitationConfigSchema`
- `packages/core/src/telemetry/schemas.ts` — `OtelConfigurationSchema`
- `packages/core/src/resources/schemas.ts` — `InternalResourcesSchema`
- `packages/core/src/prompts/schemas.ts` — `PromptsSchema`

Schemas that **move to `@dexto/agent-config`** (DI surface config shapes, core doesn't use these):
- `packages/core/src/agent/schemas.ts` → `AgentConfigSchema` (top‑level composition)
- `packages/core/src/tools/schemas.ts` → `CustomToolsSchema`, `InternalToolsSchema` (→ unified `ToolsConfigSchema`)
- `packages/core/src/plugins/schemas.ts` → `PluginsConfigSchema` (→ unified)
- `packages/core/src/context/compaction/schemas.ts` → `CompactionConfigSchema`

Schemas that were planned to **move to `@dexto/logger`** (live with implementations):
- `packages/core/src/logger/v2/schemas.ts` → `LoggerConfigSchema` (**deferred**; stays in core for now — see Phase 3.3 split notes)

Schemas that **move to `@dexto/storage`** (live with implementations, used by `StorageFactory` objects):
- `packages/core/src/storage/schemas.ts` → `StorageSchema` (top‑level composing sub‑schemas)
- `packages/core/src/storage/blob/schemas.ts` → `LocalBlobStoreSchema`, `InMemoryBlobStoreSchema`
- `packages/core/src/storage/database/schemas.ts` → database provider schemas
- `packages/core/src/storage/cache/schemas.ts` → cache provider schemas

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
import { resolveServicesFromConfig, applyImageDefaults, loadImage } from '@dexto/agent-config';

const image = await loadImage(imageName);  // dynamic import, returns DextoImageModule
const mergedConfig = applyImageDefaults(rawConfig, image.defaults);

// Flat resolution — no agent dependency, no init ordering issues
const resolved = resolveServicesFromConfig(mergedConfig, image);

const agent = new DextoAgent({
  ...mergedConfig,
  storage: resolved.storage,
  tools: resolved.tools,       // flat Tool[] — tools access agent services at runtime
  plugins: resolved.plugins,   // flat DextoPlugin[] — plugins access services via hooks
  compaction: resolved.compaction,
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
2. Writes custom tools in `tools/`, custom storage in `storage/blob/` + `storage/database/` + `storage/cache/`, etc.
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
import { sqliteFactory, inMemoryCacheFactory } from '@dexto/storage';
import { defaultLoggerFactory } from '@dexto/core'; // Phase 3.3 deferred; logger stays in core for now

const image: DextoImageModule = {
  metadata: { name: 'my-org', version: '1.0.0', description: 'Custom image' },
  defaults: {
    storage: { blob: { type: 's3', bucket: 'my-bucket' } },
  },
  tools: {
    'internal-api': myInternalToolsFactory,
  },
  storage: {
    blob: { 's3': s3BlobStoreFactory },
    database: { 'sqlite': sqliteFactory },        // re-export from @dexto/storage
    cache: { 'in-memory': inMemoryCacheFactory },
  },
  plugins: {},
  compaction: {},
  logger: defaultLoggerFactory,
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
    enabledTools: [ask_user, search_history, invoke_skill]
  - type: filesystem-tools
    allowedPaths: ["."]
  - type: process-tools
    enabled: false
```

Built‑in tools move to a `@dexto/tools-builtins` package (or similar) and become a normal tool factory:

```ts
// @dexto/tools-builtins — the former "internal tools" as a standard ToolFactory
export const builtinToolsFactory: ToolFactory = {
    configSchema: z.object({
        type: z.literal('builtin-tools'),
        enabledTools: z.array(z.enum([
            'ask_user', 'search_history', 'delegate_to_url',
            'list_resources', 'get_resource', 'invoke_skill',
        ])).optional().describe('Which built-in tools to enable. Omit for all.'),
    }).strict(),

    // create() takes ONLY config — no services. Tools access services at runtime.
    create(config): Tool[] {
        const allTools: Tool[] = [
            {
                name: 'ask_user',
                description: 'Ask the user a clarifying question',
                parameters: z.object({ question: z.string() }),
                execute: async (input, context: ToolExecutionContext) => {
                    // Services accessed at RUNTIME, not construction time
                    return context.services.approval.requestInput(input.question);
                },
            },
            {
                name: 'search_history',
                description: 'Search past conversation messages',
                parameters: z.object({ query: z.string(), limit: z.number().default(10) }),
                execute: async (input, context: ToolExecutionContext) => {
                    return context.storage.database.searchMessages(input.query, input.limit);
                },
            },
            // ... delegate_to_url, list_resources, get_resource, invoke_skill
        ];
        if (config.enabledTools) {
            return allTools.filter(t => config.enabledTools.includes(t.name));
        }
        return allTools;
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

### `ToolExecutionContext` — runtime contract for tool authors

This is what every tool's `execute()` function receives at **runtime** (not construction time). It must expose enough for ANY tool (including former "internals") to work without importing core internals:

```ts
// Exported from @dexto/core — stable contract for tool authors
interface ToolExecutionContext {
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

    // Full agent reference (simplicity now, narrow to interface later — TODO)
    agent: DextoAgent;
}
```

**Key design choices:**
- **Runtime, not construction-time** — tools are standalone objects at construction. They access services only when executing. This eliminates the agent ↔ tools init ordering cycle.
- Services are **interfaces**, not concrete classes — tool authors depend on contracts, not implementations
- No `[key: string]: any` escape hatch — every service is explicitly typed
- Full `DextoAgent` passed for simplicity — **TODO:** narrow to a dedicated `AgentContext` interface to prevent circular dependency concerns. Starting broad lets us move fast without repeatedly adjusting the surface.
- `storage` is provided so tools can persist state (e.g., jira sync, todo lists)
- The `ToolManager` inside `DextoAgent` builds this context once (after agent construction) and provides it to every tool execution. Tools don't hold references to services — they receive them per-call.

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

    // Config captured in closure — services accessed at runtime via context
    create(config): Tool[] {
        const jiraClient = new JiraClient(config.apiKey, config.baseUrl);

        return [
            {
                name: 'jira_search',
                description: 'Search Jira issues',
                parameters: z.object({ query: z.string() }),
                async execute(input, context: ToolExecutionContext) {
                    context.logger.info(`Searching Jira: ${input.query}`);
                    return jiraClient.search(input.query, config.projectId);
                },
            },
            {
                name: 'jira_create_issue',
                description: 'Create a Jira issue',
                parameters: z.object({
                    title: z.string(),
                    description: z.string(),
                    issueType: z.enum(['bug', 'story', 'task']),
                }),
                async execute(input, context: ToolExecutionContext) {
                    // Can use runtime services — e.g., request approval before creating
                    await context.services.approval.requestApproval({
                        tool: 'jira_create_issue', args: input,
                    });
                    return jiraClient.createIssue({ project: config.projectId, ...input });
                },
            },
        ];
    },
};
```

### Relevant files

| File | Lines | Disposition |
|------|-------|-------------|
| `tools/custom-tool-registry.ts` | 160 | **DELETE** — global registry, replaced by image factory maps |
| `tools/custom-tool-schema-registry.ts` | 205 | **DELETE** — schema registry, replaced by factory `configSchema` |
| `tools/internal-tools/registry.ts` | 140 | **DELETE** — internal tool name → factory map, replaced by `builtin-tools` factory |
| `tools/internal-tools/provider.ts` | 389 | **REWRITE** — remove registry lookups, accept `Tool[]` |
| `tools/schemas.ts` | 187 | **MOVE to agent-config** — `InternalToolsSchema`, `CustomToolsSchema` → unified `ToolsConfigSchema` |
| `tools/internal-tools/implementations/*.ts` | 6 files | **MOVE to `@dexto/tools-builtins`** — ask-user, search-history, delegate-to-url, list-resources, get-resource, invoke-skill |
| `tools/tool-manager.ts` | 1588 | **KEEP + update** — accept unified `Tool[]`, remove registry imports |
| `tools/types.ts` | 143 | **KEEP + update** — `Tool` interface (add `execute(input, context: ToolExecutionContext)`), `ToolExecutionContext` interface. Remove old `ToolCreationContext` (no longer needed). |
| `tools/display-types.ts` | 185 | **KEEP** — no registry dependency |
| `tools/errors.ts` | 262 | **KEEP** — no registry dependency |
| `tools/error-codes.ts` | 33 | **KEEP** — no registry dependency |
| `tools/tool-call-metadata.ts` | 69 | **KEEP** — no registry dependency |
| `tools/bash-pattern-utils.ts` | 137 | **KEEP** — no registry dependency |
| `tools/confirmation/allowed-tools-provider/factory.ts` | 46 | **DELETE** — factory replaced by DI |
| `tools/confirmation/allowed-tools-provider/*.ts` (others) | 3 files | **KEEP** — in-memory + storage implementations stay |

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
      extractionModel: claude-4.5-haiku
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

### Plugin context — same runtime pattern as tools

Plugins follow the same principle as tools: **config at construction, services at runtime.** Plugin factories receive only config. Plugins access agent services through the `PluginExecutionContext` provided by `PluginManager` when hooks fire.

```ts
// PluginExecutionContext — provided by PluginManager when hooks fire
interface PluginExecutionContext {
    logger: IDextoLogger;
    storage: {
        blob: BlobStore;
        database: Database;
        cache: Cache;
    };
    agent: DextoAgent;   // full agent (narrow to interface later — TODO)
    sessionId: string;
    userId?: string;
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

    // Config captured in closure — services accessed at runtime via execContext
    create(config): DextoPlugin {
        return {
            async beforeResponse(payload, execContext: PluginExecutionContext) {
                for (const pattern of config.blockedPatterns) {
                    if (payload.response.includes(pattern)) {
                        execContext.logger.warn(`Blocked pattern detected: ${pattern}`);
                        if (config.auditLog) {
                            await execContext.storage.database.query(
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

### Relevant files

| File | Lines | Disposition |
|------|-------|-------------|
| `plugins/registry.ts` | 143 | **DELETE** — global registry, replaced by image factory maps |
| `plugins/registrations/builtins.ts` | 44 | **DELETE** — auto-registration of built-in plugins, replaced by image |
| `plugins/schemas.ts` | 86 | **MOVE to agent-config** — `RegistryPluginConfigSchema`, `PluginsConfigSchema` → unified `PluginsConfigSchema` |
| `plugins/builtins/content-policy.ts` | 135 | **MOVE to image** — becomes a `PluginFactory` entry in image-local |
| `plugins/builtins/response-sanitizer.ts` | 121 | **MOVE to image** — becomes a `PluginFactory` entry in image-local |
| `plugins/manager.ts` | 613 | **KEEP + update** — accept `DextoPlugin[]`, remove registry lookups |
| `plugins/loader.ts` | 213 | **DELETE** — file-based plugin loading removed (all plugins come from images) |
| `plugins/types.ts` | 183 | **KEEP + update** — `DextoPlugin`, `PluginResult` interfaces. `PluginExecutionContext` updated to include `agent`, `logger`, `storage` (runtime services). Remove old `PluginCreationContext`. |
| `plugins/error-codes.ts` | 46 | **KEEP** — no registry dependency |

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

### Relevant files

| File | Lines | Disposition |
|------|-------|-------------|
| `context/compaction/registry.ts` | 33 | **DELETE** — global registry, replaced by image factory maps |
| `context/compaction/factory.ts` | 61 | **DELETE** — switch/registry factory, replaced by resolver |
| `context/compaction/schemas.ts` | 56 | **MOVE to agent-config** — `CompactionConfigSchema` |
| `context/compaction/providers/reactive-overflow-provider.ts` | 96 | **KEEP as plain export** — becomes `CompactionFactory` entry in image-local |
| `context/compaction/providers/noop-provider.ts` | 37 | **KEEP as plain export** — becomes `CompactionFactory` entry in image-local |
| `context/compaction/strategies/reactive-overflow.ts` | 490 | **KEEP** — strategy implementation, used by reactive-overflow factory |
| `context/compaction/strategies/noop.ts` | 22 | **KEEP** — strategy implementation, used by noop factory |
| `context/compaction/provider.ts` | 60 | **KEEP** — `CompactionProvider` interface, `CompactionContext` type |
| `context/compaction/types.ts` | 34 | **KEEP** — `ICompactionStrategy` interface |
| `context/compaction/overflow.ts` | 60 | **KEEP** — overflow detection utilities |
| `context/manager.ts` | 1205 | **KEEP + update** — accept `CompactionStrategy` instance instead of creating from config |
| `context/utils.ts` | 2035 | **KEEP** — no registry dependency |
| `context/types.ts` | 337 | **KEEP** — message types, no registry dependency |

---

## 11. Before/After — Storage

### High‑level goal
Storage becomes fully DI. Core receives concrete `BlobStore`, `Database`, and `Cache` instances via `DextoAgentOptions`. All storage implementations, factory functions, and config schemas are extracted from core into a new **`@dexto/storage`** package. Core keeps only the interfaces (`BlobStore`, `Database`, `Cache`) and `StorageManager` (lifecycle wrapper). `@dexto/storage` becomes the canonical collection of open-sourced storage implementations that images compose from.

### Before

Storage is config‑driven. `StorageManager` creates backends from config via factory functions that use global registries:

```yaml
# coding-agent.yml — before
storage:
  blob:
    type: local
    storePath: ./data/blobs
    maxBlobSize: 52428800
  database:
    type: sqlite
    path: ./data/agent.db
  cache:
    type: in-memory
```

```ts
// StorageManager constructor — before
constructor(config: ValidatedStorageConfig, logger: IDextoLogger) {
    this.cache = await createCache(this.config.cache, this.logger);
    this.database = await createDatabase(this.config.database, this.logger);
    this.blobStore = createBlobStore(this.config.blob, this.logger);
}

// Each factory function — same pattern (e.g., createBlobStore)
function createBlobStore(config: { type: string; [key: string]: unknown }, logger: IDextoLogger): BlobStore {
    const validatedConfig = blobStoreRegistry.validateConfig(config);     // global registry
    const provider = blobStoreRegistry.get(validatedConfig.type);         // global registry
    return provider.create(validatedConfig, logger);
}
```

Each storage sub-layer auto-registers providers as side effects in their `index.ts` barrel:
```ts
// storage/blob/index.ts — before
import { localBlobStoreProvider } from './providers/local.js';
import { inMemoryBlobStoreProvider } from './providers/memory.js';
blobStoreRegistry.register('local', localBlobStoreProvider);      // side effect on import!
blobStoreRegistry.register('in-memory', inMemoryBlobStoreProvider);
```

**Problems:** Three global mutable singleton registries (`blobStoreRegistry`, `databaseRegistry`, `cacheRegistry`). Factory functions exist solely to do registry lookups. Side-effect auto-registration on import. `StorageManager` accepts config instead of instances.

### After

Image provides storage factories. Resolver creates concrete instances. Core receives them directly.

```yaml
# coding-agent.yml — after (unchanged for users)
storage:
  blob:
    type: local
    storePath: ./data/blobs
    maxBlobSize: 52428800
  database:
    type: sqlite
    path: ./data/agent.db
  cache:
    type: in-memory
```

Image provides typed storage factories (split per category):
```ts
// image-local storage map — typed per category prevents mismatches
storage: {
    blob: { 'local': localBlobStoreFactory, 'in-memory': inMemoryBlobStoreFactory },
    database: { 'sqlite': sqliteFactory, 'postgres': postgresFactory, 'in-memory': inMemoryDatabaseFactory },
    cache: { 'in-memory': inMemoryCacheFactory, 'redis': redisCacheFactory },
},
```

Resolver creates concrete instances:
```ts
const resolved = resolveServicesFromConfig(mergedConfig, image);
// resolved.storage = {
//   blob: LocalBlobStore (concrete, connected),
//   database: SqliteDatabase (concrete, connected),
//   cache: InMemoryCache (concrete, connected),
// }
```

Core receives concrete instances:
```ts
new DextoAgent({
    storage: {
        blob: BlobStore,      // concrete instance, no type strings
        database: Database,   // concrete instance
        cache: Cache,         // concrete instance
    },
});
```

`StorageManager` becomes a lifecycle wrapper:
```ts
// StorageManager — after
class StorageManager {
    constructor(
        { blob, database, cache }: { blob: BlobStore; database: Database; cache: Cache },
        logger: IDextoLogger,
    ) {
        this.blobStore = blob;
        this.database = database;
        this.cache = cache;
        // No creation logic. Just stores references.
    }

    async initialize() {
        await this.cache.connect();
        await this.database.connect();
        await this.blobStore.connect();
    }
}
```

### What a custom storage factory looks like

```ts
// In a custom image (e.g., image-cloud)
export const supabaseBlobFactory: BlobStoreFactory = {
    configSchema: z.object({
        type: z.literal('supabase'),
        bucket: z.string(),
        projectUrl: z.string().url(),
        serviceKey: z.string(),
    }).strict(),

    create(config, logger: IDextoLogger): BlobStore {
        return new SupabaseBlobStore(config.bucket, config.projectUrl, config.serviceKey, logger);
    },
};
```

### Relevant files

| File | Lines | Disposition |
|------|-------|-------------|
| **Blob** | | |
| `storage/blob/registry.ts` | 59 | **DELETE** — global singleton registry |
| `storage/blob/registry.test.ts` | 548 | **DELETE** — tests for deleted registry |
| `storage/blob/factory.ts` | 54 | **DELETE** — registry-based factory, replaced by `BlobStoreFactory.create()` |
| `storage/blob/schemas.ts` | 110 | **MOVE to `@dexto/storage`** — factory config schemas live with implementations |
| `storage/blob/provider.ts` | 54 | **MOVE to `@dexto/storage`** — `BlobStoreProvider` interface, used by factories |
| `storage/blob/types.ts` | 163 | **KEEP in core** — `BlobStore` interface (core's contract) |
| `storage/blob/local-blob-store.ts` | 586 | **MOVE to `@dexto/storage`** — implementation |
| `storage/blob/memory-blob-store.ts` | 418 | **MOVE to `@dexto/storage`** — implementation |
| `storage/blob/providers/local.ts` | 28 | **MOVE to `@dexto/storage`** — becomes `BlobStoreFactory` entry (remove auto-registration) |
| `storage/blob/providers/memory.ts` | 28 | **MOVE to `@dexto/storage`** — becomes `BlobStoreFactory` entry (remove auto-registration) |
| `storage/blob/index.ts` | 83 | **REWRITE** — core barrel only exports `BlobStore` interface; `@dexto/storage` gets its own barrel |
| **Database** | | |
| `storage/database/registry.ts` | 59 | **DELETE** — global singleton registry |
| `storage/database/registry.test.ts` | 224 | **DELETE** — tests for deleted registry |
| `storage/database/factory.ts` | 56 | **DELETE** — registry-based factory |
| `storage/database/schemas.ts` | 101 | **MOVE to `@dexto/storage`** — factory config schemas |
| `storage/database/provider.ts` | 60 | **MOVE to `@dexto/storage`** — `DatabaseProvider` interface |
| `storage/database/types.ts` | 24 | **KEEP in core** — `Database` interface |
| `storage/database/sqlite-store.ts` | 319 | **MOVE to `@dexto/storage`** — implementation |
| `storage/database/postgres-store.ts` | 407 | **MOVE to `@dexto/storage`** — implementation |
| `storage/database/memory-database-store.ts` | 121 | **MOVE to `@dexto/storage`** — implementation |
| `storage/database/providers/sqlite.ts` | 52 | **MOVE to `@dexto/storage`** — becomes `DatabaseFactory` entry |
| `storage/database/providers/postgres.ts` | 43 | **MOVE to `@dexto/storage`** — becomes `DatabaseFactory` entry |
| `storage/database/providers/memory.ts` | 28 | **MOVE to `@dexto/storage`** — becomes `DatabaseFactory` entry |
| `storage/database/index.ts` | 84 | **REWRITE** — core barrel only exports `Database` interface |
| **Cache** | | |
| `storage/cache/registry.ts` | 59 | **DELETE** — global singleton registry |
| `storage/cache/registry.test.ts` | 215 | **DELETE** — tests for deleted registry |
| `storage/cache/factory.ts` | 54 | **DELETE** — registry-based factory |
| `storage/cache/schemas.ts` | 77 | **MOVE to `@dexto/storage`** — factory config schemas |
| `storage/cache/provider.ts` | 60 | **MOVE to `@dexto/storage`** — `CacheProvider` interface |
| `storage/cache/types.ts` | 16 | **KEEP in core** — `Cache` interface |
| `storage/cache/memory-cache-store.ts` | 99 | **MOVE to `@dexto/storage`** — implementation |
| `storage/cache/redis-store.ts` | 182 | **MOVE to `@dexto/storage`** — implementation |
| `storage/cache/providers/memory.ts` | 29 | **MOVE to `@dexto/storage`** — becomes `CacheFactory` entry |
| `storage/cache/providers/redis.ts` | 48 | **MOVE to `@dexto/storage`** — becomes `CacheFactory` entry |
| `storage/cache/index.ts` | 74 | **REWRITE** — core barrel only exports `Cache` interface |
| **Top-level storage** | | |
| `storage/storage-manager.ts` | 274 | **KEEP in core + rewrite** — accept concrete instances, remove factory calls |
| `storage/schemas.ts` | 61 | **MOVE to `@dexto/storage`** — top-level `StorageSchema` composing sub-schemas |
| `storage/schemas.test.ts` | 436 | **MOVE to `@dexto/storage`** — tests for moved schema |
| `storage/errors.ts` | 428 | **KEEP in core** — error factory (errors are part of the contract) |
| `storage/error-codes.ts` | 60 | **KEEP in core** — error codes |
| `storage/types.ts` | 6 | **KEEP in core** — type re-exports |
| `storage/index.ts` | 113 | **REWRITE** — only export interfaces + `StorageManager` |

**Summary:** 9 files deleted (3 registries + 3 registry tests + 3 factories). ~20 files move to `@dexto/storage` (implementations, factories, schemas). Core keeps interfaces, `StorageManager`, error types.

### Dependency graph after extraction

```
@dexto/core
  ├── BlobStore interface
  ├── Database interface
  ├── Cache interface
  └── StorageManager (lifecycle wrapper)
       ↑
@dexto/storage
  ├── Implementations: SqliteStore, PostgresStore, LocalBlobStore, MemoryBlobStore, etc.
  ├── StorageFactory objects: sqliteFactory, postgresFactory, localBlobFactory, etc.
  ├── Config schemas: SqliteDatabaseSchema, PostgresDatabaseSchema, etc.
  └── Provider-specific deps: better-sqlite3, pg, ioredis
       ↑
@dexto/image-local
  └── storage: { blob: { 'local': localBlobFactory, ... }, database: { 'sqlite': sqliteFactory, ... }, cache: { ... } }
```

---

## 12. Defaults merging strategy

**Note:** With unified config fields (`tools` replaces `internalTools`/`customTools`, `plugins` replaces `plugins.registry`/`plugins.custom`), defaults merging becomes simpler — no need to merge two separate plugin arrays.

Image defaults are useful — they let an image say "if you don't specify storage, use SQLite by default" so that every agent config doesn't need boilerplate.

**Strategy: shallow merge at the top level, config wins. Atomic units replace entirely.**

- **Scalar fields:** Config wins. `image.defaults.agentId = 'default'`, config `agentId: 'my-agent'` → result is `'my-agent'`.
- **Object fields (storage, LLM, etc.):** Merge one level deep. If agent config specifies `storage.blob`, the entire `storage.blob` object comes from config (including all its sub-fields). If agent config omits `storage.blob`, the image default for `storage.blob` is used. No deep recursive merge — each sub-object is an atomic unit.
  - Example: image defaults `storage.blob: { type: 'local', storePath: './data/blobs' }`, config specifies `storage.blob: { type: 's3', bucket: 'my-bucket' }` → result is `{ type: 's3', bucket: 'my-bucket' }` (no `storePath` bleeds through from defaults).
- **Array fields (`tools`, `plugins`):** Config **replaces** the default array entirely (no concatenation, no merging-by-type). If config specifies `tools: [...]`, those are the tools. If config omits `tools`, the image default `tools` array is used.
  - Rationale: merging arrays by `type` is ambiguous (does config override defaults by type? append? prepend?). Full replacement is predictable.
  - **Common `enabled` flag for tool factory entries:** Each entry in `tools: [...]` MAY include `enabled: false` to disable that tool factory without deleting the config block. The resolver MUST:
    - skip disabled entries (treat them as absent), and
    - strip `enabled` before validating against the factory's `.strict()` `configSchema` to avoid schema failures.
- **Missing fields:** If config omits a field entirely and image defaults provide it, the default is used.
- Merging happens in `@dexto/agent-config` via `applyImageDefaults()`, not in core.
- `configDir` is NOT passed into core. Core does not perform path resolution; it consumes whatever paths it is given. Product layers can expand template vars (e.g., `${{dexto.agent_dir}}`) and inject absolute defaults (e.g., storage paths) before constructing the agent.

---

## 13. Migration approach

**Breaking changes are acceptable.** No compatibility shims.

### Affected packages (in dependency order)
1. `@dexto/core` — constructor changes, remove registries + `BaseRegistry` class, accept concrete instances, extract implementations
2. `@dexto/agent-config` (new) — resolver, defaults merging, `AgentConfigSchema`, `ValidatedAgentConfig`
3. `@dexto/storage` (new) — all storage implementations + `StorageFactory` objects extracted from core
4. `@dexto/logger` (deferred) — planned logger extraction + `LoggerFactory` (see Phase 3.3 split notes)
5. `@dexto/tools-builtins` (new) — former internal tools as standard `ToolFactory`
6. `@dexto/image-bundler` — generate `DextoImageModule` with explicit imports, remove `.toString()`
7. `@dexto/image-local` — rewrite as `DextoImageModule` (hand‑written, imports from storage/logger/tools-builtins)
8. `@dexto/agent-management` — remove config parsing responsibilities
9. `@dexto/cli` — use new resolution flow
10. `@dexto/server` — use new resolution flow
11. `dexto-cloud/apps/platform` — migrate `image-cloud` to `DextoImageModule`, use new resolution flow

### Error experience
When a user's YAML references `type: filesystem-tools` but the image doesn't provide it, the resolver in `@dexto/agent-config` should produce a clear error:
```
Error: Unknown tool type 'filesystem-tools'.
  Available types from image 'image-local': filesystem-tools, process-tools, todo-tools, plan-tools
  Hint: Make sure your image provides this tool factory.
```

This error is generated by the `resolveFactory` helper, which has access to `Object.keys(image.tools)` to list available types.

---

## 14. Platform deployment model

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
- **BYOK support [future feature] **: If a user has Bring Your Own Key configured, the gateway resolves their stored keys server‑side. The agent environment doesn't change — still just `DEXTO_API_KEY`.
- **Low cost**: Worker processes (Node.js child_process pool) provide process‑level isolation without the overhead of Docker containers. Sandbox containers are only needed for coding agents that require filesystem/process access.
- **Same gateway path**: This is the same network path CLI users already use with `provider: dexto`. No extra infrastructure.

### How both coexist

The `DextoAgent` constructor is identical in both cases — it always receives concrete instances. The difference is where those instances come from:
- Config‑only: platform image factories produce everything
- Code‑based: user image factories produce custom tools/plugins, platform handles infrastructure (LLM via gateway, storage via platform services)

---

## 15. Config migration strategy

### Current state
- 100+ types derived from Zod schemas via `z.output<typeof Schema>` and `z.input<typeof Schema>`
- `ValidatedAgentConfig` is a single monolithic branded type (`z.output<typeof AgentConfigSchema>`) used by 12+ files in core
- `AgentConfigSchema` (in `packages/core/src/agent/schemas.ts`) composes 20+ sub‑schemas, mixing config‑based surfaces (LLM, MCP, sessions) with DI surfaces (storage, tools, plugins, compaction, logger)
- Manager constructors accept Zod‑derived sub‑config types: `ValidatedLLMConfig`, `ValidatedStorageConfig`, `ValidatedSystemPromptConfig`, etc.

### Strategy: Split schema composition (Option A), build toward zero‑Zod core (Option C)

**Phase 1 goal (Option A):** Move the top‑level `AgentConfigSchema` composition and DI surface schemas out of core into `@dexto/agent-config`. Core keeps module‑level schemas for config‑based surfaces only.

**Long‑term goal (Option C):** Incrementally replace remaining `z.output` types in core with plain TypeScript interfaces, one module at a time, until core has zero Zod dependency. Option A paves the way by establishing the boundary.

### What moves to `@dexto/agent-config`

1. **`AgentConfigSchema`** — the top‑level composition that glues all sub‑schemas into the YAML shape
2. **`ValidatedAgentConfig`** type — the monolithic output of YAML parsing
3. **DI surface schemas:** `CustomToolsSchema` (→ `ToolsConfigSchema`), `PluginsConfigSchema`, `CompactionConfigSchema` — these move to `@dexto/agent-config`. `StorageConfigSchema` moves to `@dexto/storage`. `LoggerConfigSchema` stays in `@dexto/core` for now (Phase 3.3 deferred).
4. **The YAML → `DextoAgentOptions` transformation** — extract DI sections, resolve via image factories, pass remainder + instances

Agent‑config **imports core's sub‑schemas** to compose the full YAML schema — no duplication:

```ts
// @dexto/agent-config/src/schemas/agent-config.ts
import { LLMConfigSchema, SessionConfigSchema, McpServersConfigSchema,
         SystemPromptConfigSchema, MemoriesConfigSchema, ApprovalSchemas,
         TelemetrySchema, ResourcesSchema, PromptsSchema } from '@dexto/core';

// DI surface schemas — core doesn't need these
import { StorageConfigSchema } from '@dexto/storage';  // lives with implementations
import { ToolsConfigSchema } from './tools.js';
import { PluginsConfigSchema } from './plugins.js';
import { CompactionConfigSchema } from './compaction.js';
    import { LoggerConfigSchema } from '@dexto/core';       // stays in core (Phase 3.3 deferred)

export const AgentConfigSchema = z.object({
    agentId: z.string().default('coding-agent'),
    agentCard: AgentCardSchema.optional(),
    greeting: z.string().optional(),
    image: z.string().optional(),

    // Imported from core (config-based, core managers need these)
    llm: LLMConfigSchema,
    systemPrompt: SystemPromptConfigSchema,
    mcpServers: McpServersConfigSchema.default({}),
    sessions: SessionConfigSchema.default({}),
    toolConfirmation: ToolConfirmationConfigSchema.default({}),
    elicitation: ElicitationConfigSchema.default({}),
    internalResources: InternalResourcesSchema.default([]),
    prompts: PromptsSchema.default([]),
    memories: MemoriesConfigSchema.optional(),
    telemetry: TelemetrySchema.optional(),

    // Defined locally (DI surfaces — core never sees these shapes)
    storage: StorageConfigSchema.default({}),
    tools: ToolsConfigSchema.default([]),       // unified: replaces internalTools + customTools
    plugins: PluginsConfigSchema.default([]),    // unified: replaces plugins.registry + plugins.custom
    compaction: CompactionConfigSchema.default(DEFAULT_COMPACTION_CONFIG),
    logger: LoggerConfigSchema.default({}),
}).strict();

export type ValidatedAgentConfig = z.output<typeof AgentConfigSchema>;
```

### What stays in core

1. **Module‑level schemas:** `LLMConfigSchema`, `SessionConfigSchema`, `McpServersConfigSchema`, `SystemPromptConfigSchema`, etc. — these define what data core's managers need. That's interface definition, not config coupling.
2. **Module‑level validated types:** `ValidatedLLMConfig`, `ValidatedSessionConfig`, etc. — managers keep using these as constructor args.
3. **`DextoAgentOptions`** — the new constructor type combining config fields + DI instances.
4. **Interface types:** `BlobStore`, `Database`, `Cache`, `Tool`, `DextoPlugin`, `CompactionStrategy`, `IDextoLogger`.
5. **LLM schemas + resolver + factory + registry** — LLM is entirely config‑driven and stays in core.

### Type flow (after)

```
YAML → AgentConfigSchema.parse() → ValidatedAgentConfig
         (in @dexto/agent-config)          │
                                           │
  ┌────────────────────────────────────────┤
  │ DI sections extracted by resolver:     │ Config sections passed through:
  │  config.storage → image factories      │  config.llm → ValidatedLLMConfig
  │  config.tools → image factories        │  config.mcpServers → ValidatedMcpServersConfig
  │  config.plugins → image factories      │  config.sessions → ValidatedSessionConfig
  │  config.compaction → image factories   │  config.systemPrompt, config.memories, etc.
  │  config.logger → createLogger()        │
  └────────────────────────┬───────────────┘
                           │
                           ▼
  DextoAgentOptions = { ...configSections, storage, tools, plugins, compaction, logger }
                           │
                           ▼
  new DextoAgent(DextoAgentOptions)  ← core never sees storage/tools/plugins/compaction config shapes
```

### Key migration details

**`DextoAgent.switchLLM()`** currently calls `AgentConfigSchema.parse()` for re‑validation. After the move, it uses `LLMConfigSchema` directly (which stays in core). LLM switching only validates LLM config, not the full agent config. ✅ No issue.

**`AgentStateManager`** currently stores the full `ValidatedAgentConfig` for state export. After: stores `DextoAgentOptions`. State export serializes config‑based sections + metadata about DI instances (e.g., tool names, storage type).

**`DextoAgent.config` public property** currently exposes `ValidatedAgentConfig`. After: expose `DextoAgentOptions` (or a subset). Breaking change for external consumers — acceptable.

### Risk: `ValidatedAgentConfig` coupling in core

12 files currently import `ValidatedAgentConfig`. After the split:

**Files that destructure DI sections from `ValidatedAgentConfig` (must change):**
- `packages/core/src/utils/service-initializer.ts` — creates storage, tools, plugins from config → **deleted/moved**
- `packages/core/src/storage/storage-manager.ts` — accepts `ValidatedStorageConfig` → accepts concrete instances
- `packages/core/src/tools/internal-tools/provider.ts` — resolves tools from `customToolRegistry` → accepts `Tool[]`
- `packages/core/src/plugins/manager.ts` — resolves plugins from `pluginRegistry` → accepts `DextoPlugin[]`
- `packages/core/src/context/compaction/factory.ts` — resolves from `compactionRegistry` → accepts `CompactionStrategy`

**Files that use config‑only sections (no change needed):**
- `packages/core/src/llm/services/factory.ts` — uses `ValidatedLLMConfig` → stays
- `packages/core/src/mcp/manager.ts` — uses `ValidatedServerConfigs` → stays
- `packages/core/src/systemPrompt/manager.ts` — uses `ValidatedSystemPromptConfig` → stays
- `packages/core/src/session/session-manager.ts` — uses `SessionManagerConfig` → stays
- `packages/core/src/memory/manager.ts` — uses `Database` directly → stays

**Files that reference `ValidatedAgentConfig` for other reasons (must update):**
- `packages/core/src/agent/DextoAgent.ts` — constructor + `public config` → use `DextoAgentOptions`
- `packages/core/src/agent/state-manager.ts` — state tracking → use `DextoAgentOptions`
- `packages/core/src/events/index.ts` — event type definition → update type reference
- `packages/core/src/prompts/prompt-manager.ts` — passes full config → narrow to `config.prompts`
- `packages/core/src/plugins/registrations/builtins.ts` — extracts `config.plugins` → removed (plugins are DI)
- Barrel exports (`index.ts`, `index.browser.ts`) — stop exporting `AgentConfigSchema`, `ValidatedAgentConfig`

### Long‑term path to Option C

After Option A is complete, each remaining module‑level schema can be independently refactored:

1. Pick a module (e.g., `sessions`)
2. Define a plain TS interface for its config: `interface SessionConfig { ... }`
3. Update `SessionManager` constructor to accept the plain interface
4. Move the Zod schema to agent‑config (for YAML validation only)
5. Core no longer imports Zod for that module

Repeat for each module. Eventually core has zero Zod dependency. Each step is a small, safe PR.

---

## 16. Events vs Hooks

### Current state

The `AgentEventBus` is a fully typed `BaseTypedEventEmitter<AgentEventMap>` with compile‑time safety, `AbortSignal` cleanup, and clear tiers (`AgentEventBus` global vs `SessionEventBus` session‑scoped). There are ~91 `.on()` subscriptions across the codebase:

| Layer | Count | Purpose |
|-------|-------|---------|
| Core (internal) | ~30 | Module coordination (ToolManager/PromptManager/ResourceManager listen to MCP events to sync state) |
| CLI | ~27 | Rendering — stream chunks, show spinners, display compaction status |
| Server | ~34 | SSE streaming, webhook delivery, approval coordination |
| Tools | 0 subscribe, 1 emitter | Tools emit `service:event`, never subscribe |

**Assessment:** The current internal event pattern is healthy. Core modules subscribe for coordination, CLI/server subscribe for presentation. No decoupling needed here — this is what event buses are for.

### `agent.on()` convenience API

Currently consumers access events via `agent.agentEventBus.on(...)`, which exposes internal implementation. We will add a convenience API:

```typescript
class DextoAgent {
  on<K extends keyof AgentEventMap>(event: K, listener: AgentEventMap[K], options?: { signal?: AbortSignal }): this;
  once<K extends keyof AgentEventMap>(event: K, listener: AgentEventMap[K], options?: { signal?: AbortSignal }): this;
  off<K extends keyof AgentEventMap>(event: K, listener: AgentEventMap[K]): this;
}
```

This delegates to `this.agentEventBus` internally. Over time, direct `agentEventBus` access can be deprecated in favor of the cleaner `agent.on()` surface.

### Design principle: events for observation, hooks for modification

Both patterns are complementary and should coexist:

| | Events (`agent.on()`) | Hooks (plugin lifecycle) |
|---|---|---|
| **Timing** | Post‑hoc — "this happened" | Interception — "this is about to happen" |
| **Can modify?** | No — read‑only observation | Yes — can transform, filter, block |
| **Coupling** | Loose — emitter doesn't know listeners | Structured — explicit typed contract |
| **Ordering** | Unordered | Priority‑ordered |
| **Best for** | Logging, metrics, UI rendering, SSE streaming, webhooks | Policy enforcement, content transformation, approval gating, audit |

**Use `agent.on()`** when you want to observe/react to what happened — rendering, logging, metrics, streaming, webhooks. Your code doesn't return anything or modify state.

**Use a plugin with hooks** when you want to modify/intercept/gate behavior — content policy, approval logic, response transformation, custom compaction triggers. Your code influences the outcome.

### Events emitted by core only

Core managers (`ToolManager`, `TurnExecutor`, `ContextManager`, `PluginManager`) remain the sole event emitters. Extension points (tools, plugins, strategies) do **not** emit events — core emits before/after calling them. This ensures consistent event ordering and prevents extension points from producing invalid event sequences.

### Future enhancement: plugin event access

Plugins currently use hooks only (typed, discoverable, priority‑ordered). A future enhancement could add read‑only event access via a `subscribe` method on the plugin interface:

```typescript
interface DextoPlugin {
  hooks?: { ... };
  subscribe?: (agent: DextoAgent) => void;  // read-only event access
}
```

This would let a single plugin both intercept (hooks) and observe (events) — e.g., an audit plugin that gates tool execution AND logs all LLM responses. Not needed for the initial refactor.

---

## 17. Future enhancements (out of scope)

These are related improvements that **depend on this refactor being complete** but are tracked as separate efforts. They are not part of the tasklist below.

### A) Tool surface refactor

**Tracked in:** `feature-plans/image-and-core-di-refactor/TOOL-SURFACE-REFACTOR.md`

**Depends on:** Phase 1B (tools unified into `Tool[]`), Phase 3.1 (`@dexto/tools-builtins` exists)

**What it does:** Removes hardcoded tool name knowledge from core, CLI, and WebUI. Currently ~25 tool names are hardcoded across ~30 files for display formatting, approval logic, and prompt inclusion. The refactor:
- Removes the `internal--` / `custom--` prefix system from tool names
- Extends the `Tool` interface with `display?`, `approval?`, `aliases?` metadata fields
- Tools declare their own behavior (e.g., bash tool provides its own pattern key generator)
- Core becomes truly tool‑agnostic — zero hardcoded tool names
- CLI/WebUI read tool metadata from event payloads instead of maintaining parallel name checks

**Why separate:** Touches different files (CLI rendering, WebUI components, prompt templates) and is a distinct conceptual change from the DI refactor. The DI refactor unifies tools; this refactor makes core tool‑agnostic.

### B) YAML static validation (IDE extension)

**Tracked in:** `feature-plans/yaml-schema-validation/PLAN.md`

**Depends on:** Phase 2.5 (`AgentConfigSchema` in `@dexto/agent-config`), Phase 3.2 (`DextoImageModule` exists)

**What it does:** Generates JSON Schema from the Zod `AgentConfigSchema`, enabling real‑time in‑editor validation for agent YAML configs. Three layers:
1. **Base schema** — image‑agnostic JSON Schema from `AgentConfigSchema` (autocomplete for all fields)
2. **Image‑specific schema** — constrains `tools[].type`, `storage.blob.type`, etc. to the image's factory keys
3. **Per‑tool config** — JSON Schema `if/then` to validate tool‑specific config fields based on `type`

Deliverables: CLI command (`dexto schema generate`), optional VS Code extension, published schemas per image version.

### C) Convention folder configurability

Custom image folder naming (e.g., `src/tools/` instead of `tools/`) via a separate config file, similar to `next.config.ts`. Ship with fixed conventions first (`tools/`, `storage/blob/`, `storage/database/`, `storage/cache/`, `plugins/`, `compaction/`), add configurability when requested.

### D) Image `include` shorthand

Allow `dexto.image.ts` to declare external package re‑exports without wrapper files:
```yaml
include:
  tools: ['@dexto/tools-filesystem', '@dexto/tools-process']
```
Bundler generates imports automatically. Convenience feature, not required for v1.

### E) Plugin event access

Let plugins subscribe to agent events via a `subscribe` method on the plugin interface, enabling plugins that both intercept (hooks) and observe (events). See Section 16 for details.

---

## 18. Commit & PR strategy

This is a large refactor (~80 files, 50+ tasks). We use a **single feature branch with one mega PR**, but with disciplined per‑task commits to ensure safe checkpointing and easy `git bisect`.

### Principles

1. **Every commit must leave the codebase buildable and testable.** Run `pnpm run build && pnpm test` after each commit. If a commit breaks the build, fix it before moving on.
2. **One commit per task.** Each numbered task (1.1, 1.2, etc.) gets exactly one commit (or one squashed commit if you iterate). This makes `git bisect` useful and reverts clean.
3. **Single PR, many commits.** All phases land in one mega PR on a long‑lived feature branch. The commit history within the PR provides the modularity — each commit is a self‑contained, buildable step.

### Branch strategy

```
main
  └── feat/di-refactor (single long-lived branch → one mega PR)
        ├── commit: 0.1 — create agent-config package skeleton
        ├── commit: 0.2 — define DextoImageModule + factory types
        ├── commit: 0.3 — define DextoAgentOptions in core
        ├── ...
        ├── commit: 1.1 — decouple blob storage from registry
        ├── commit: 1.2 — decouple database from registry
        ├── ...
        ├── commit: 5.4 — update documentation
        └── commit: 5.5 — update OpenAPI docs
```

Phase 6 (platform) is a separate effort in `dexto-cloud`.

### Commit message convention

```
refactor(scope): X.Y — short description

Detailed explanation of what changed and why.
Exit criteria met: [build/test/lint/typecheck pass]
```

Examples:
```
refactor(core/storage): 1.1 — decouple blob storage from registry

- Delete blobStoreRegistry and blob factory function
- Remove auto-registration from blob/index.ts
- Keep BlobStore interface in core
- Exit: zero registry imports in storage/blob/. Build + tests pass.
```

```
refactor(core/tools): 1.7 — accept unified Tool[] in ToolManager

- Remove InternalToolsSchema and CustomToolsSchema imports
- ToolManager constructor takes Tool[] instead of separate configs
- No internalTools/customTools distinction in core
- Exit: ToolManager has zero registry imports. Build + tests pass.
```

### Phase checkpoints

Even though this is one PR, validate at each phase boundary to catch drift early:

| Phase boundary | Checkpoint validation |
|----------------|----------------------|
| **After Phase 0** (commit 0.5) | New package builds. Types compile. Zero `any` in new interfaces. |
| **After Phase 1A** (commit 1.4) | `StorageManager` accepts concrete instances. Zero registry imports in `storage/`. |
| **After Phase 1B** (commit 1.7) | `ToolManager` accepts `Tool[]`. Zero registry imports in `tools/`. |
| **After Phase 1C** (commit 1.8) | `PluginManager` accepts `DextoPlugin[]`. Zero registry imports in `plugins/`. |
| **After Phase 1D** (commit 1.9) | `ContextManager` accepts `CompactionStrategy`. Zero registry imports in `context/compaction/`. |
| **After Phase 1E** (commit 1.23) | `DextoAgent` constructor takes `DextoAgentOptions`. `agent.on()` works. |
| **After Phase 1F** (commit 1.29) | All registries deleted. `rg 'BaseRegistry\|blobStoreRegistry\|databaseRegistry\|cacheRegistry\|customToolRegistry\|pluginRegistry\|compactionRegistry' packages/core/src/` → zero results. |
| **After Phase 2** (commit 2.6) | `resolveServicesFromConfig()` works with mock image. `AgentConfigSchema` in agent‑config. |
| **After Phase 3** (commit 3.7) | `@dexto/tools-builtins`, `@dexto/storage` created. Logger extraction (3.3) deferred (logger remains in core). `image-local` exports typed `DextoImageModule`. |
| **After Phase 4** (commit 4.5) | `dexto` CLI starts. Chat works. Server mode works. Manual smoke test passes. |
| **After Phase 5** (commit 5.5) | Zero dead code. Full test pass. Docs updated. All quality checks green. |

### Checkpoint validation command (run at every phase boundary)

```bash
pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck
```

Additionally, at key milestones:
- **After Phase 1 complete:** `rg 'BaseRegistry|blobStoreRegistry|databaseRegistry|cacheRegistry|customToolRegistry|pluginRegistry|compactionRegistry' packages/core/src/` → zero results
- **After Phase 3 complete:** `import imageLocal from '@dexto/image-local'` returns typed `DextoImageModule`
- **After Phase 4 complete:** Manual smoke test — start CLI, chat with agent, use tools, switch agents

### Rollback within the PR

If a phase causes issues, `git revert` individual commits or ranges. Each commit is atomic and buildable, so reverting a specific task's commit leaves the codebase in a working state. The per‑task commit discipline makes this safe even in a mega PR.

---

## 19. Summary

- **Core should be DI‑first**: accept concrete storage, tools, plugins, compaction strategy, logger. No config resolution, no implementations inside core — only interfaces and orchestration.
- **Unified tools**: `internalTools` + `customTools` merge into a single `tools` concept. All tools come from the image. Former "internal" tools move to `@dexto/tools-builtins` as a standard `ToolFactory`. Core receives `Tool[]` and doesn't distinguish origins.
- **Unified plugins**: `plugins.registry` + `plugins.custom` merge into a single `plugins` list. All plugins come from image factories. Core receives `DextoPlugin[]`.
- **Compaction is DI**: Core receives a concrete `CompactionStrategy` instance. Custom strategies are provided via image factories, same pattern as tools/plugins.
- **LLM stays config‑based**: Schemas, registry, factory, and resolver all stay in core. No changes needed for the DI refactor.
- **Product layer owns config**: CLI/platform parse, merge defaults, and resolve via `@dexto/agent-config`.
- **Images remain**, but as **typed `DextoImageModule` objects** with plain `Record<string, Factory>` maps for each extension point (tools, storage, plugins, compaction, logger).
- **No registries anywhere.** The image object IS the lookup table. `BaseRegistry` class is removed entirely. The resolver does plain property access: `image.tools[config.type]`.
- **Config at construction, services at runtime** (Mastra-inspired pattern):
  - **Tool/plugin/compaction factories** take **only config** in `create()`. No services, no agent reference.
  - **Tools access services at runtime** via `ToolExecutionContext` (logger, storage, approval, search, etc.) provided by `ToolManager` on each `execute()` call.
  - **Plugins access services at runtime** via `PluginExecutionContext` provided by `PluginManager` when hooks fire.
  - similar for compaction
  - This **eliminates the init ordering cycle** entirely — no two-phase init, no lazy getters, no callbacks. The resolver builds everything independently in a flat top-to-bottom flow.
- **Storage maps are typed per category**: `storage: { blob: Record<string, BlobStoreFactory>; database: Record<string, DatabaseFactory>; cache: Record<string, CacheFactory> }`. This prevents type-unsafe mismatches at compile time (e.g., accidentally putting a sqlite factory in the blob map).
- **Two ways to build images**: convention‑based (bundler generates object literal from folders) or hand‑written (for re‑exports or full control). Both produce the same `DextoImageModule` interface.
- **Bundler emits explicit imports** into a plain object — no `.toString()`, no duck‑typing, no `register()` calls.
- **Defaults merging is precise**: shallow merge at top level, config wins. Object sub-fields are atomic units (no deep merge bleed-through). Arrays replace entirely.
- **`configDir` removed from core** — core does not do path resolution. `configDir` was only needed for file-based plugin loading and debug context; plugins now come from images, and system-prompt file loading resolves paths independently.
- **Breaking changes are fine** — no compatibility shims needed.
- **Platform code‑based agents** run in worker processes with `DEXTO_API_KEY` for LLM access via the existing gateway. No platform secrets exposed.
- **Convention folder configurability and `include` shorthand are future enhancements** — ship with fixed conventions first.
- **Implementation packages extracted from core:**
  - `@dexto/storage` — all storage implementations + typed `StorageFactory` objects (SQLite, Postgres, local blob, memory, Redis) + storage config schemas
  - `@dexto/logger` — (deferred) logger extraction + `LoggerFactory` + logger config schema (see Phase 3.3 split notes; logger stays in core for now)
  - `@dexto/tools-builtins` — former internal tools as standard `ToolFactory`
  - Core keeps only interfaces (`BlobStore`, `Database`, `Cache`, `IDextoLogger`, `Tool`, `DextoPlugin`, `CompactionStrategy`, `ToolExecutionContext`, `PluginExecutionContext`) and orchestration (`StorageManager`, `ToolManager`, `PluginManager`, etc.)
- **YAML UX unchanged**: Users still write `type: filesystem-tools` in config. The difference is that core no longer resolves type strings — the resolver layer does, using the image's factory maps.
- **Events + hooks coexist**: `agent.on()` convenience API for passive observation (rendering, metrics, streaming). Plugin hooks for active modification (policy, transformation, gating). Core is the sole event emitter — extension points do not emit events.

This preserves CLI UX while cleaning architecture, increasing type safety, and enabling both config‑based and code‑based agent customization paths.

---

## 20. Tasklist

### Phase 0: Foundation — new package + core interfaces
> **Goal:** Establish the new package and define the target types before changing anything.

- [ ] **0.1 Create `@dexto/agent-config` package skeleton**
  - `packages/agent-config/package.json`, `tsconfig.json`, `src/index.ts`
  - Add to pnpm workspace, turbo pipeline, `.changeset/config.json` fixed array
  - Follow same tsconfig/build patterns as the other packages. There are some specific things to reduce memory overload/etc. which we should follow.
  - Exit: package builds with `pnpm run build`, exports nothing yet

- [ ] **0.2 Define `DextoImageModule` interface + factory types**
  - `packages/agent-config/src/image/types.ts`
  - `DextoImageModule`, `ToolFactory`, `BlobStoreFactory`, `DatabaseFactory`, `CacheFactory`, `PluginFactory`, `CompactionFactory`, `LoggerFactory`
  - Storage factories split per category: `storage: { blob: Record<string, BlobStoreFactory>; database: Record<string, DatabaseFactory>; cache: Record<string, CacheFactory> }`
  - Tool/plugin factories take **only config** — no services at construction
  - Zero `any` types. Use `unknown` + Zod for validation.
  - Exit: types compile, can be imported from `@dexto/agent-config`

- [ ] **0.3 Define `DextoAgentOptions` interface in core**
  - New type in `packages/core/src/agent/types.ts` (or similar)
  - Combines config fields (Zod‑derived, for LLM/MCP/sessions/etc.) + DI instances:
    - `storage: { blob: BlobStore; database: Database; cache: Cache }`
    - `tools: Tool[]`
    - `plugins: DextoPlugin[]`
    - `compaction: CompactionStrategy`
    - `logger: IDextoLogger`
  - This is the NEW constructor type. `ValidatedAgentConfig` moves to `@dexto/agent-config` for YAML validation only.
  - Exit: type compiles, documents every field with JSDoc

- [ ] **0.4 Define core interfaces for DI surfaces (if not already clean)**
  - Verify `BlobStore`, `Database`, `Cache`, `Tool` (InternalTool), `DextoPlugin`, `CompactionStrategy`, `IDextoLogger` interfaces exist and are clean (no `any`, no config coupling)
  - `CompactionStrategy` interface must be defined if it doesn't exist as a standalone interface (currently may be embedded in compaction provider types). make sure to refactor properly and delete unncessary code.
  - If any are missing or config‑coupled, define them
  - Exit: all DI surface interfaces are importable from `@dexto/core` with zero `any`

- [ ] **0.5 Define `ToolExecutionContext` and `PluginExecutionContext` interfaces**
  - **`ToolExecutionContext`** (runtime — provided by `ToolManager` when tools execute):
    - `agent: DextoAgent` (full agent for now — **TODO: narrow to interface later**)
    - `logger: IDextoLogger`
    - `storage: { blob: BlobStore; database: Database; cache: Cache }`
    - `services: { approval: ApprovalService; search: SearchService; resources: ResourceService; prompts: PromptService; mcp: McpService }`
  - **`PluginExecutionContext`** (runtime — provided by `PluginManager` when hooks fire):
    - `agent: DextoAgent`, `logger`, `storage`, `sessionId`, `userId?`
  - **No `ToolCreationContext` or `PluginCreationContext`** — factories take only config, not services. This eliminates the agent ↔ tools init ordering cycle.
  - Remove all `any` types from existing contexts
  - Exit: both runtime context interfaces compile with zero `any`. Build passes.

---

### Phase 1: Core accepts DI instances (the big refactor)
> **Goal:** Make core's constructor and internal wiring accept concrete instances instead of resolving from config.
> **This is the highest‑risk phase.** Every subtask should end with `pnpm run build && pnpm test` passing.
> **Every sub‑module in `packages/core/src/` must be vetted.** The tasks below are ordered by dependency: infrastructure first, then modules that depend on them, then the agent shell, then cleanup.

#### 1A — Storage layer (`packages/core/src/storage/`)

> **Note on implementations:** Phase 1A only removes registries and factory wiring. All concrete implementations (`LocalBlobStore`, `SqliteStore`, `MemoryCache`, etc.) remain in core as plain exports throughout Phases 1–2. They are physically extracted to `@dexto/storage` in Phase 3.2. This keeps Phase 1 focused on DI changes and avoids combining a large file move with the registry removal.

- [ ] **1.1 `storage/blob/` — decouple from registry**
  - Files: `registry.ts` (59 lines), `factory.ts` (55 lines), `provider.ts`, `providers/local.ts`, `providers/memory.ts`, `local-blob-store.ts`, `memory-blob-store.ts`, `schemas.ts`, `types.ts`, `index.ts`
  - `factory.ts` calls `blobStoreRegistry.validateConfig()` + `.get()` → remove this path from core. Factory moves to resolver or is deleted.
  - `providers/local.ts` and `providers/memory.ts` auto‑register in `index.ts` → remove auto‑registration, keep as plain exports
  - `registry.ts` + `registry.test.ts` → delete
  - `schemas.ts` (provider config schemas: `LocalBlobStoreSchema`, `InMemoryBlobStoreSchema`) → stay in core for now (moves to `@dexto/storage` in Phase 3.2)
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

**Key change: `internalTools` + `customTools` unify into a single `tools: Tool[]`.** Core receives a flat list. It doesn't distinguish "built‑in" from "custom." Former "internal" tools (ask_user, search_history, etc.) stay in core as plain exports during Phase 1, then move to `@dexto/tools-builtins` in Phase 3.1.

- [ ] **1.5 `tools/custom-tool-registry.ts` — mark for deletion**
  - `CustomToolRegistry` (160 lines) + `custom-tool-schema-registry.ts` → will be deleted in 1.10
  - First: identify all importers within core (internal‑tools/provider.ts, tool-manager.ts, schemas.ts, index.ts)
  - Exit: dependency map documented.

- [ ] **1.6 `tools/internal-tools/` — decouple built‑in tool creation**
  - `InternalToolsProvider` currently: (a) creates built‑in tools from hardcoded implementations, (b) resolves custom tools via `customToolRegistry` → remove (b) entirely
  - Built‑in tool *implementations* (`ask-user-tool.ts`, `search-history-tool.ts`, etc.) stay in core for now as plain exports — they'll be moved to `@dexto/tools-builtins` in Phase 3
  - `InternalToolsProvider` itself may become unnecessary (since all tools arrive as `Tool[]`) — assess whether to keep as internal wiring or remove
  - `tools/internal-tools/registry.ts` — vet if this is separate from custom tool registry. If it's a hardcoded list of internal tool names, it stays for now.
  - Update `provider.test.ts`
  - Exit: `InternalToolsProvider` has zero imports from `customToolRegistry`. Build + tests pass.

- [ ] **1.7 `tools/tool-manager.ts` — accept unified `Tool[]` + provide `ToolExecutionContext` at runtime**
  - Currently receives `CustomToolsConfig` (Zod type) + `internalTools` (string array) separately
  - After: receives a single `Tool[]` — all tools pre‑resolved. No `internalTools`/`customTools` distinction.
  - `ToolManager` also receives (or builds) a `ToolExecutionContext` that it provides to tools on every `execute()` call. This context is built by `DextoAgent` after full construction (no init cycle).
  - Tool interface: `execute(input: unknown, context: ToolExecutionContext) => Promise<unknown>`
  - Remove `InternalToolsSchema` and `CustomToolsSchema` imports from core (move to agent‑config in Phase 2)
  - Vet: `tool-call-metadata.ts`, `bash-pattern-utils.ts`, `display-types.ts`, `errors.ts`, `types.ts`, `schemas.ts` — assess if any reference registries
  - Vet: `tools/confirmation/` subfolder (allowed‑tools‑provider) — likely no registry dependency, but verify
  - Update `tool-manager.test.ts`, `tool-manager.integration.test.ts`
  - Exit: `ToolManager` accepts `Tool[]`, provides `ToolExecutionContext` at runtime, has zero registry imports, no internalTools/customTools split. Build + tests pass.

#### 1C — Plugins layer (`packages/core/src/plugins/`)

**Key change: `plugins.registry` + `plugins.custom` unify into a single `plugins: DextoPlugin[]`.** Core receives a flat list. Built‑in plugins (content‑policy, response‑sanitizer) stay in core as plain exports during Phase 1, then become `PluginFactory` entries in image‑local (Phase 3.5).

- [ ] **1.8 `plugins/manager.ts` — accept concrete `DextoPlugin[]`**
  - `PluginManager.initialize()` currently uses `pluginRegistry.get()` for registry plugins + `loader.ts` for custom file paths → remove both resolution paths
  - After: receives pre‑resolved `DextoPlugin[]`
  - `loader.ts` (loads plugins from file paths) → **delete** (file-based plugins removed; use images)
  - `builtins/content-policy.ts`, `builtins/response-sanitizer.ts` — keep as plain exports for now, move to image factory in Phase 3
  - `registrations/builtins.ts` — delete (built‑in plugins will be registered via image, not core)
  - `registry.ts` (142 lines) → delete
  - `schemas.ts` (`RegistryPluginConfigSchema`, `PluginsConfigSchema`) → move to agent‑config for YAML validation
  - `types.ts` — `DextoPlugin` interface must be clean for DI
  - Update `registry.test.ts` (delete), `manager.ts` tests
  - Exit: `PluginManager` accepts `DextoPlugin[]`, has zero registry imports, no registry/custom split. Build + tests pass.

#### 1D — Context / Compaction (`packages/core/src/context/`)

**Key change: Compaction is DI.** Core receives a concrete `CompactionStrategy` instance. No config‑based strategy resolution in core. Built‑in strategies (reactive‑overflow, noop) stay in core as plain exports during Phase 1, then become `CompactionFactory` entries in image‑local (Phase 3.5).

- [ ] **1.9 `context/compaction/` — decouple from registry, accept `CompactionStrategy`**
  - Files: `registry.ts` (32 lines), `factory.ts`, `provider.ts`, `providers/reactive-overflow-provider.ts`, `strategies/`, `schemas.ts`, `types.ts`
  - `factory.ts` calls `compactionRegistry.get()` → delete (resolution moves to resolver: `image.compaction[config.type].create()`)
  - `registry.ts` → delete
  - `CompactionConfigSchema` → move to agent‑config for YAML validation
  - Built‑in strategies (`reactive-overflow`, etc.) stay in core as plain exports — they become `CompactionFactory` entries in image‑local (Phase 3)
  - Core receives concrete `CompactionStrategy` via `DextoAgentOptions`
  - Vet: `overflow.ts`, `strategies/` — these are internal implementations, keep as plain exports
  - Vet: `context/media-helpers.ts`, `context/types.ts`, `context/manager.ts` — unrelated to registries, verify
  - Exit: `context/compaction/` has zero registry imports. Core accepts `CompactionStrategy` directly. Build + tests pass.

#### 1E — Agent shell + service initializer (`packages/core/src/agent/`, `utils/`)

- [ ] **1.10 `agent/DextoAgent.ts` — constructor accepts `DextoAgentOptions`**
  - Change constructor from `(config: AgentConfig, configPath?, options?)` to `(options: DextoAgentOptions)`
  - `DextoAgentOptions` includes concrete storage, tools, plugins, compaction, logger + config sections for LLM/MCP/sessions/etc.
  - Remove `serviceOverrides` / `InitializeServicesOptions` pattern
  - Remove `AgentConfigSchema` import — schema moves to agent‑config. `switchLLM()` uses `LLMConfigSchema` directly.
  - `public config: ValidatedAgentConfig` → replace with `DextoAgentOptions` (or expose config‑only subset)
  - **Build `ToolExecutionContext` internally** after full construction — `this.buildToolContext()` method creates the runtime context with `{ agent: this, logger, storage, services: { approval, search, resources, prompts, mcp } }`. Pass to `ToolManager`. No `ToolCreationContext` needed — factories take only config.
  - **Build `PluginExecutionContext` similarly** — `PluginManager` receives a context builder.
  - Vet: `agent/state-manager.ts` — uses `ValidatedAgentConfig` for state tracking → update to `DextoAgentOptions`
  - Vet: `agent/schemas.ts` — remove `AgentConfigSchema` (moved to agent‑config). Keep sub‑schema re‑exports if needed.
  - Vet: `agent/types.ts` — add `DextoAgentOptions` here
  - Vet: `agent/errors.ts`, `agent/error-codes.ts` — likely no changes
  - Vet: `agent/agentCard.ts` — likely no changes
  - Exit: constructor compiles with new type. `ToolExecutionContext` built internally. Callers outside core will break (expected — fixed in Phase 4).

- [ ] **1.11 `utils/service-initializer.ts` — rewrite**
  - Currently 316 lines creating all services from config
  - After: most creation moves to resolver layer. What remains is **internal wiring** that can't move:
    - `SearchService(database, logger)` — uses resolved database
    - `MemoryManager(database, logger)` — uses resolved database
    - `MCPManager` + `initializeFromConfig()` — uses config (MCP stays config‑driven)
    - `ApprovalManager` — uses config (policies are data)
    - `ResourceManager` — uses MCP manager + config
    - `SessionManager` — wires together all other services
    - `SystemPromptManager` — uses config + memory manager (remove `configDir` param; file paths are resolved by contributors at runtime, and product layers can expand template vars)
  - May rename to `initializeInternalServices()` with a reduced signature
  - **Remove `configDir` from core entirely** — core doesn't need it (no file-based plugins; system prompt manager doesn't require it).
  - Exit: no registry imports, no `configDir`. Takes DI instances + config, wires internal dependencies only. Build passes.

#### 1F — Remaining core sub‑modules (vet for registry/config coupling)

Each of these sub‑modules must be checked for registry imports or tight coupling to `ValidatedAgentConfig` fields that are becoming DI. Most should require NO changes, but must be verified.

- [ ] **1.12 `llm/` — vet (expect: no changes)**
  - LLM stays config‑driven (`ValidatedLLMConfig`). No registries involved (LLM registry is model metadata, not a provider registry).
  - Vet: `services/factory.ts` (creates Vercel model from config — stays), `services/vercel.ts`, `executor/turn-executor.ts`
  - Vet: `llm/registry/` — this is the MODEL registry (model names, pricing, capabilities). Completely separate from provider registries. Stays as‑is.
  - Vet: `llm/providers/local/` — local model provider. Verify no provider registry dependency.
  - Vet: `llm/formatters/` — message formatting. Likely no changes.
  - Vet: `llm/validation.test.ts`, `llm/schemas.ts` — stay
  - LLM config validation and switching stay entirely in core. `switchLLM()` uses `LLMConfigSchema` (stays in core). No changes needed.
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

- [ ] **1.16 `systemPrompt/` — vet (expect: minor changes)**
  - `SystemPromptManager(config, configDir, memoryManager, memoriesConfig, logger)` — takes config (data) + concrete memory manager.
  - **Remove `configDir` parameter** — `SystemPromptManager` doesn't require it. Any path resolution is handled independently (contributors resolve paths; product layers can expand template vars).
  - Vet: `manager.ts`, `contributors.ts`, `in-built-prompts.ts`, `registry.ts` (is this a provider registry? Investigate), `schemas.ts`
  - **Risk:** `systemPrompt/registry.ts` — name suggests a registry pattern. Must investigate whether it's a provider registry or just a contributor registry (internal).
  - Exit: no `configDir` dependency. No provider registry dependency. Document any internal registries.

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

- [ ] **1.21 `logger/` — vet (expect: DI change; implementation extraction deferred)**
  - Logger becomes a DI instance. Core receives `IDextoLogger`, doesn't create it from config.
  - Vet: `logger.ts` (v1), `v2/` (v2 logger system — ~10 files). Understand which is used.
  - Phase 1: make core depend only on `IDextoLogger` interface. Move `createLogger()` calls out of core. Implementations stay in core as plain exports.
  - Phase 3.3 (original plan): extract logger impl + schemas to `@dexto/logger`.
  - **Update (2026-02-10):** extraction is split/deferred (see Phase 3.3 notes) due to layering issues; keep `createLogger()` + `LoggerConfigSchema` in core for now.
  - Exit (Phase 1): core uses `IDextoLogger` interface only. No logger creation from config in core.

- [ ] **1.22 `telemetry/` — vet (expect: minimal changes)**
  - Telemetry is config‑driven (`OtelConfigurationSchema`).
  - Vet: `telemetry.ts`, `decorators.ts`, `exporters.ts`, `utils.ts`, `schemas.ts`
  - Telemetry init currently happens in service initializer — may stay in internal wiring or move to resolver
  - Exit: document decision. Confirm no registry dependency.

- [ ] **1.23 `events/` — vet + add `agent.on()` convenience API**
  - `AgentEventBus` is created early in DextoAgent constructor. No config dependency.
  - Vet: `index.ts` — no registry imports expected
  - **Add `agent.on()`, `agent.once()`, `agent.off()` to `DextoAgent`** — thin delegates to `this.agentEventBus`
  - Fully typed via `AgentEventMap` — same type safety as direct bus access
  - Update CLI/server to use `agent.on()` instead of `agent.agentEventBus.on()` (can be incremental)
  - Delete direct `agent.agentEventBus` property access completely from the codebase and from documentation that references it
  - Exit: `agent.on('llm:chunk', handler)` works. Sufficient tests for other event cases. Build + tests pass.

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
  - Ideal: There are some utils files that are duplicates of other ones in agent-management that were left here because we couldn't decouple fully. ideally as part of this, we should be able to delete those here also!

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
  - Remove: `AgentConfigSchema`, `ValidatedAgentConfig` (moved to agent‑config)
  - Remove: DI surface schemas (`CustomToolsSchema`, `PluginsConfigSchema`, `CompactionConfigSchema`) → agent‑config. `StorageSchema` → `@dexto/storage`. `LoggerConfigSchema` stays in core for now (Phase 3.3 deferred).
  - Keep: all interface exports (`BlobStore`, `Database`, `Cache`, `Tool`, `DextoPlugin`, `CompactionStrategy`, `IDextoLogger`, `DextoAgentOptions`, etc.)
  - Keep: module‑level config exports (sub‑schemas like `LLMConfigSchema`, `SessionConfigSchema`, etc. + their derived types)
  - Vet: `index.browser.ts` — browser‑safe exports subset. Remove registry exports here too.
  - Exit: `packages/core/src/index.ts` has zero registry exports, no `AgentConfigSchema`. Build + all downstream packages compile.

- [ ] **1.29 Final validation — all registries gone from core**
  - `rg 'Registry' packages/core/src/ --type ts` → only LLM model registry (legitimate, not a provider registry)
  - `rg 'registry' packages/core/src/ --type ts -i` → audit remaining hits
  - `pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck` → all pass
  - Exit: core is registry‑free. All quality checks pass.

---

### Phase 2: Build the resolver (`@dexto/agent-config`)
> **Goal:** The new package can take a `ValidatedAgentConfig` + `DextoImageModule` and produce a `DextoAgentOptions`.

- [ ] **2.5 Move `AgentConfigSchema` + DI schemas to agent‑config**
  - **Decision (made):** `AgentConfigSchema` moves to `@dexto/agent-config`. Core keeps module‑level sub‑schemas.
  - Create `packages/agent-config/src/schemas/agent-config.ts` — imports core sub‑schemas + defines DI surface schemas locally
  - **Unify tool selection/config into one `tools: [...]` array** (removes `internalTools` + `customTools`). Breaking change OK — update all first‑party configs.
  - **Add common `enabled?: boolean` to tool factory entries here (this step owns the schema design).**
    - Semantics: `enabled: false` means "skip this entry entirely" (do not validate or create).
    - Implementation note: since many tool factory schemas are `.strict()`, the resolver must strip `enabled` before validating against `factory.configSchema`.
    - Add a short comment in the agent‑config schema + resolver explaining A+B+C semantics (defaults vs override vs enabled) and how to migrate to Option D (`{ type, enabled?, config }`) if we ever need more shared fields.
  - Resolve naming collision: the old per‑tool limits object currently lives at `config.tools` in core (`ToolsConfigSchema` record). With unified `tools: [...]`, either:
    - rename it to `toolLimits` (or similar), or
    - delete it for now (it is currently schema-only; no runtime usage).
  - Move DI surface schemas: `PluginsConfigSchema` (unified), `CompactionConfigSchema` → agent‑config. Import `StorageConfigSchema` from `@dexto/storage` and `LoggerConfigSchema` from `@dexto/core` (Phase 3.3 deferred).
  - Move `ValidatedAgentConfig` type to agent‑config
  - Keep `AgentCardSchema` (shared) — decide location (may stay in core since `agentCard` is in `DextoAgentOptions`)
  - Remove `AgentConfigSchema` + `ValidatedAgentConfig` from core's `schemas.ts` and barrel exports
  - Exit: `AgentConfigSchema` lives in agent‑config, imports core sub‑schemas. Core has zero top‑level config schema. Build passes (downstream packages update imports).

- [ ] **2.1 `applyImageDefaults(config, imageDefaults)`**
  - Merge semantics match Section 12: shallow top-level merge, 1-level-deep object merge with atomic sub-objects, arrays replace. Config wins.
  - Unit tests with various merge scenarios
  - Exit: function works, tests pass, handles edge cases (missing defaults, missing config sections)

- [ ] **2.2 `resolveServicesFromConfig(config, image)`**
  - Implements the factory resolution: `image.tools[config.type]` → validate → create
  - Handles unified tool resolution: `config.tools` (single array, replaces internalTools + customTools) → `Tool[]`
    - Skip entries with `enabled: false`
    - Strip `enabled` before validating against `factory.configSchema`
  - Handles tool grouping (one factory → `Tool[]`, e.g., `builtin-tools` → [ask_user, search_history, ...])
  - Handles storage resolution: uses typed sub-maps (`image.storage.blob`, `image.storage.database`, `image.storage.cache`)
  - Handles unified plugin resolution: `config.plugins` (single array, replaces plugins.registry + plugins.custom) → `DextoPlugin[]`
  - Handles compaction resolution: `config.compaction` → `CompactionStrategy`
  - Creates logger from `image.logger` factory
  - **No agent dependency** — all factories take only config. No `ToolCreationContext`/`PluginCreationContext` to build. No two-phase init. Resolution is flat: logger → storage → tools → plugins → compaction.
  - Produces `ResolvedServices` object
  - Exit: unit tests with mock image + mock config produce correct concrete instances. Error cases tested (unknown type, validation failure).

- [ ] **2.6 Define `ValidatedAgentConfig → DextoAgentOptions` transformer**
  - Function in agent‑config that takes the full YAML‑validated config + resolved services and produces `DextoAgentOptions`
  - Extracts config‑based sections, combines with DI instances
  - This is the bridge between config world and DI world
  - Exit: transformer tested, produces valid `DextoAgentOptions` from `ValidatedAgentConfig` + `ResolvedServices`.

- [ ] **2.3 `loadImage(imageName)` helper**
  - Dynamic import wrapper that returns `DextoImageModule`
  - Validates the imported module conforms to `DextoImageModule` shape (runtime check)
  - Clear error if import fails or shape doesn't match
  - Tests to validate error messages are clear for different shape problems
  - Exit: can load `@dexto/image-local` (once rewritten) and return typed module

- [ ] **2.4 Remove storage factory functions from core**
  - **Defer** until Phase 5.1 cleanup (or after Phase 4 integration) to avoid churn while CLI/server still use transitional wiring.
  - `createBlobStore()`, `createDatabase()`, `createCache()` — delete once the resolver path is end‑to‑end
  - Exit: no standalone `createBlobStore`/`createDatabase`/`createCache` anywhere.

---

### Phase 3: Image system rewrite
> **Goal:** Images export `DextoImageModule` objects. No side effects, no `.toString()`, no registries.
> **Ordering rationale:** Extraction packages (3.1–3.2) must be created before image‑local (3.5) can import from them. Tool adapter work (3.4) is independent. (Logger extraction 3.3 is split/deferred.)

- [ ] **3.1 Create `@dexto/tools-builtins` package (former internal tools)**
  - New package: `packages/tools-builtins/`
  - Move internal tool implementations from `packages/core/src/tools/internal-tools/implementations/` to this package
  - Export a single `builtinToolsFactory: ToolFactory` that creates ask_user, search_history, delegate_to_url, list_resources, get_resource, invoke_skill
  - Factory `create()` takes **only config** — tools access services at runtime via `ToolExecutionContext` (approval, search, resources, prompts passed per-execution by `ToolManager`)
  - Config schema: `{ type: 'builtin-tools', enabledTools?: string[] }` — omit `enabledTools` for all
  - Exit: package builds, exports `ToolFactory`. Former internal tools work via factory. Build passes.

- [ ] **3.2 Create `@dexto/storage` package (extract from core)**
  - New package: `packages/storage/`
  - Move ALL storage implementations from `packages/core/src/storage/`:
    - Blob: `local-blob-store.ts` (586 lines), `memory-blob-store.ts` (418 lines), `providers/local.ts`, `providers/memory.ts`
    - Database: `sqlite-store.ts` (319 lines), `postgres-store.ts` (407 lines), `memory-database-store.ts` (121 lines), `providers/sqlite.ts`, `providers/postgres.ts`, `providers/memory.ts`
    - Cache: `memory-cache-store.ts` (99 lines), `redis-store.ts` (182 lines), `providers/memory.ts`, `providers/redis.ts`
  - Move storage config schemas: `blob/schemas.ts`, `database/schemas.ts`, `cache/schemas.ts`, `schemas.ts`
  - Move provider interfaces: `blob/provider.ts`, `database/provider.ts`, `cache/provider.ts`. Vet if these are still necessary as well.
  - Create `StorageFactory`‑compatible objects for each implementation (remove auto‑registration)
  - Provider-specific dependencies (`better-sqlite3`, `pg`, `ioredis`) move to this package
  - Core keeps: `BlobStore`/`Database`/`Cache` interfaces, `StorageManager`, error types
  - Core's storage barrel exports only interfaces + `StorageManager`
  - `@dexto/storage` depends on `@dexto/core` (for interface types)
  - Exit: `@dexto/storage` builds, exports all `StorageFactory` objects. Core's storage layer is interfaces only. Build passes.

- [ ] **3.3 Logger extraction (split; deferred)**
  - We attempted to extract logger impl + schemas into `@dexto/logger`, but hit a layering issue:
    - `@dexto/logger` naturally depends on `@dexto/core` for `IDextoLogger`/`DextoLogComponent` (+ typed errors), so core cannot import logger impl back without a dependency cycle.
    - A few **core** utilities used a global logger for best-effort diagnostics (telemetry shutdown warning, LLM registry auto-update, OpenRouter model registry refresh). After extraction, those callsites would need `console.*` fallbacks or additional DI threading.
  - **Decision (2026-02-10):** keep logger implementation + `LoggerConfigSchema` in `@dexto/core` for now so this refactor doesn’t get blocked by logging concerns.
  - Split follow-up (optional) if we want extraction later without the `console.*` smell:
    - [ ] **3.3a Create `@dexto/logger-types`** (interfaces/enums only; no Node deps)
    - [ ] **3.3b Create `@dexto/logger`** (impl + schemas + factories) depending on `@dexto/logger-types` (not core)

- [ ] **3.4 Adapt existing tool provider packages**
  - `@dexto/tools-filesystem`, `@dexto/tools-process`, `@dexto/tools-todo`, `@dexto/tools-plan`
  - Each currently exports a `CustomToolProvider<Type, Config>` — verify it matches `ToolFactory` or create adapter
  - Remove `customToolRegistry.register()` calls if any exist
  - Exit: each tool package exports a `ToolFactory`‑compatible object. No registry imports.

- [ ] **3.5 Rewrite `@dexto/image-local` as hand‑written `DextoImageModule`**
  - **Depends on:** 3.1 (tools-builtins), 3.2 (storage), 3.4 (tool adapters). (Logger stays in core for now.)
  - Delete `dexto.image.ts` + bundler‑generated output
  - Write `index.ts` exporting `DextoImageModule` with factory maps
  - Dependencies: `@dexto/tools-builtins`, `@dexto/tools-filesystem`, `@dexto/tools-process`, `@dexto/tools-todo`, `@dexto/tools-plan`, `@dexto/storage`
  - Tools map: `builtin-tools` (from `@dexto/tools-builtins`), `filesystem-tools`, `process-tools`, `todo-tools`, `plan-tools`
  - Plugins map: `content-policy`, `response-sanitizer` (former built‑in plugins)
  - Compaction map: `reactive-overflow`, `noop` (built‑in strategies from core)
  - Storage map (split per category):
    - `blob: { 'local': localBlobStoreFactory, 'in-memory': inMemoryBlobStoreFactory }`
    - `database: { 'sqlite': sqliteFactory, 'postgres': postgresFactory, 'in-memory': inMemoryDatabaseFactory }`
    - `cache: { 'in-memory': inMemoryCacheFactory, 'redis': redisCacheFactory }`
  - Logger: default logger factory wrapper around `@dexto/core`’s `createLogger()` + `LoggerConfigSchema` (until 3.3 is revisited)
  - Exit: `import imageLocal from '@dexto/image-local'` returns typed `DextoImageModule`. No side effects on import. Build passes.

- [ ] **3.6 Update `@dexto/image-bundler`**
  - Generate `DextoImageModule` object literal with explicit imports (not `register()` calls)
  - Folder name → type string mapping (`tools/jira/` → key `'jira'`)
  - Storage conventions:
    - `storage/blob/<type>/` → `image.storage.blob['<type>']`
    - `storage/database/<type>/` → `image.storage.database['<type>']`
    - `storage/cache/<type>/` → `image.storage.cache['<type>']`
  - Generated module includes `logger: defaultLoggerFactory` (wrapper around core `createLogger()` + `LoggerConfigSchema`, until 3.3 is revisited)
  - Remove `.toString()` serialization logic entirely
  - Remove duck‑typing discovery — require explicit `export const provider` contract
  - Exit: bundler generates valid `DextoImageModule`. Can bundle a test image with convention folders. Proper documentation inside the repo for how to use this as well.

- [ ] **3.7 Remove old image infrastructure from core**
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
  - Update `@dexto/agent-management` agent creation surfaces to use the new resolution flow (not core glue):
    - `AgentManager.loadAgent(...)`
    - `AgentFactory.createAgent(...)`
    - `AgentRuntime.spawnAgent(...)`
  - might not even be required anymore if image concept can handle this natively. vet and discuss with the user
  - Exit: config enrichment works with new resolution flow. Build + tests pass.

- [ ] **4.5 End‑to‑end smoke test**
  - Start CLI with default image → chat with agent → tools work (filesystem, process)
  - Start server mode → API calls work
  - Switch agents → works
  - Request user to run the smoke test and give clear instructions
  - Exit: manual smoke test passes. All CI checks green (`pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck`).

---

### Phase 5: Cleanup + testing
> **Goal:** Remove all dead code, fix all broken tests, add new tests.

- [ ] **5.0 Flatten `DextoAgentOptions` + remove core config indirection**
  - **Goal:** Match the “Proposed DextoAgent surface” in this plan: everything at the top level (no `options.config` wrapper), and core only tracks *config-like* runtime settings it truly owns.
  - Introduce a core type like `AgentRuntimeSettings` that includes only config-based surfaces core actually uses at runtime:
    - Keep: LLM, MCP servers, sessions, toolConfirmation/elicitation, systemPrompt/memories/prompts, telemetry, internalResources, greeting/agentCard, etc.
    - Remove from core “settings”: any image-bounded DI surfaces and host concerns (`storage`, `tools`, `plugins`, `compaction`, `logger` config, `image`, etc.)
  - Change `DextoAgentOptions` to be flat:
    - `DextoAgentOptions = AgentRuntimeSettings & { logger: IDextoLogger; storage: ...; tools: ...; plugins: ...; compaction?: ...; overrides?: ... }`
    - No `config` subfield.
  - Move/delete host-only fields from core:
    - Remove `configPath`/`getAgentFilePath()`/`reload()` from core (these are CLI/server/agent-management concerns)
    - Remove `agentFile` config from core (instruction discovery belongs to host layers / contributors, not core runtime)
  - Update `AgentStateManager` to track/export only `AgentRuntimeSettings` (or a patch/delta), not a YAML-shaped “full agent config”
  - **Glue strategy clarification:** Phase 4 should make transitional glue paths *unused* (product layers supply DI instances). Phase 5 deletes them and removes all `// TODO: temporary glue code...` markers.
  - Exit: `DextoAgentOptions` is flat; core has no file-path concerns; CLI/server still support edit/reload UX via host-managed config; build + tests pass.

- [ ] **5.1 Delete dead registry code**
  - All `*Registry` classes, singleton instances, factory functions that used registries
  - `providers/discovery.ts` (unless we want a non‑registry version)
  - Registry test files
  - Remove all `TODO: temporary glue code to be removed/verified` markers (they should not survive past cleanup)
  - Exit check: `rg "temporary glue code|remove-by:" packages` returns zero results
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

### Phase 5.6: Owner verification (pre‑platform gate)
> **Goal:** Ensure all deferred owner decisions / manual verifications are resolved before starting Phase 6 (platform).

- [ ] **5.6.1 Review and resolve `USER_VERIFICATION.md`**
  - Resolve items, or explicitly defer them (move to a follow‑up plan) before proceeding
  - Exit: `USER_VERIFICATION.md` is empty or all items are marked resolved with dates/notes.

---

### Phase 6: Platform migration (dexto‑cloud) — separate effort
> **Goal:** Platform uses new resolution flow. Image‑cloud migrated. Stop here and do not start this phase until user asks you to.

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
                                                         Phase 5.6 (owner verification)
                                                                       ↓
                                                                 Phase 6 (platform)
```

**Phases 1 and 2 can partially overlap:** as each core module is decoupled (1.1, 1.2, 1.3), the corresponding resolver section (2.2) can be built to exercise it.

**New packages created:**
- `@dexto/agent-config` — resolver, config schemas, image loading
- `@dexto/storage` — all storage implementations + `StorageFactory` objects
- `@dexto/logger` — (deferred) logger extraction; keep in core for now (see Phase 3.3 split notes)
- `@dexto/tools-builtins` — former internal tools as `ToolFactory`

**Estimated blast radius:**
- ~80 files import from registries → all need updating
- ~20 files import `ValidatedAgentConfig` for constructor paths → need `DextoAgentOptions`
- ~20 files move from core to `@dexto/storage` (implementations, schemas, providers)
- ~10 files would move from core to `@dexto/logger` if/when Phase 3.3 is revisited (currently deferred)
- ~6 files move from core to `@dexto/tools-builtins` (internal tool implementations)
- ~15 test files test registry behavior → delete or rewrite
- ~6 registry classes + 6 singleton instances → all deleted
- 1 service initializer (316 lines) → rewritten/moved
- 1 `DextoAgent.ts` (2869 lines) → constructor + `start()` significantly changed
- 2 image packages → rewritten
- 1 image bundler → `.toString()` logic removed, generates new output format
