# Core Path Utilities Migration Plan

## Problem Statement

Currently, Dexto's core package contains opinionated file-based defaults through `getDextoPath()` and related utilities. This creates several issues:

1. **Serverless incompatibility**: Core assumes filesystem access, preventing use in serverless environments
2. **Tight coupling**: Services have hardcoded fallbacks to path utilities, making them less flexible
3. **Missing configuration**: Logger has no config fields at all, hardcoding its path
4. **Mixed responsibility**: Core handles both runtime logic AND default path decisions

## Current Architecture

### Config Structure

Our config is comprehensive and ALREADY supports explicit paths:

```typescript
AgentConfigSchema
├── llm: LLMConfigSchema
├── storage: StorageSchema
│   ├── database: DatabaseConfigSchema
│   │   ├── type: 'in-memory' | 'sqlite' | 'postgres'
│   │   ├── path: string (optional) ← Already configurable!
│   │   └── database: string (filename)
│   └── blob: BlobStoreConfigSchema
│       ├── type: 'in-memory' | 'local'
│       └── storePath: string (optional) ← Already configurable!
├── sessions: SessionConfigSchema
└── telemetry: OtelConfigurationSchema
```

### The Real Problem

Services have internal fallbacks when config doesn't specify paths:

**packages/core/src/storage/database/sqlite-store.ts:50-51**
```typescript
const storageDir = getDextoPath('database');  // ← Core decides path!
const finalPath = path.join(storageDir, dbName);
```

**packages/core/src/logger/logger.ts:198**
```typescript
this.logFilePath = getDextoPath('logs', 'dexto.log');  // ← Hardcoded!
```

**packages/core/src/storage/blob/local-blob-store.ts:57-58**
```typescript
const blobSubdir = this.agentId ? `blobs-${this.agentId}` : 'blobs';
this.storePath = config.storePath || getDextoPath('data', blobSubdir);  // ← Fallback
```

### Services Using Path Utilities

| Service | Current Behavior | Agent Isolation | Config Support |
|---------|-----------------|-----------------|----------------|
| **Logger** | `getDextoPath('logs', 'dexto.log')` | ❌ SHARED | ❌ No config |
| **SQLite Store** | `getDextoPath('database')` + `${agentId}.db` | ✅ Per-agent | ✅ Optional path |
| **Blob Storage** | `getDextoPath('data', 'blobs-${agentId}')` | ✅ Per-agent | ✅ Optional storePath |
| **Filesystem Service** | `getDextoPath('backups')` | ❌ SHARED | ❌ No config |
| **API Key Store** | `getDextoEnvPath()` - writes .env | ❌ SHARED | ❌ No config |
| **MCP Client** | `resolveBundledScript()` | N/A | N/A (bundled) |
| **Prompt Provider** | `findDextoSourceRoot()` / `findDextoProjectRoot()` | N/A | N/A (source) |

## Comparison: Dexto vs Mastra

### Mastra (Code-First)

```typescript
const agent = new Agent({
    name: 'Bird checker',
    instructions: 'You can view an image...',
    model: anthropic('claude-3-haiku-20240307'),
    storage: new PostgresMemory({ /* config */ }),
});
```

**Characteristics:**
- TypeScript-first configuration
- Dependencies passed to constructor
- Synchronous initialization
- Type-safe at compile time
- Storage is a single abstraction

### Dexto (Config-First)

```yaml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

storage:
  database:
    type: sqlite
    path: ./data/dexto.db
  blob:
    type: local
    storePath: ~/.dexto/blobs
```

**Characteristics:**
- YAML-first configuration
- Zod schema validation at runtime
- Async initialization (start())
- Runtime validation with helpful errors
- Two-tier storage (cache + database)

**Both approaches are valid** - they serve different use cases:
- Mastra: Library-first, embedded in TypeScript apps
- Dexto: CLI-first, YAML-driven agent definitions

## Proposed Architecture

### High-Level Changes

1. **CLI enriches config** - `packages/cli` or `@dexto/agent-management` populates path defaults
2. **Core trusts config** - Remove `getDextoPath()` fallbacks from services
3. **Add logger config** - Make logger configurable like other services
4. **Per-agent isolation** - All file-based resources use agent ID in paths
5. **Optional code-first API** - Future enhancement for Mastra-like usage

### Requirements

From user:
1. **Core should not have file-based defaults** - "Core is just the runtime and should work in serverless environments"
2. **CLI should set these defaults** - "The CLI should probably be the one to set these defaults"
3. **Per-agent isolation** - "Separate agent IDs will have their own log files, their own DB files by default, etc."

### Implementation Approach

#### Phase 1: Add Logger Config to Schema

**packages/core/src/agent/schemas.ts**
```typescript
const LoggerConfigSchema = z.object({
    logPath: z.string().optional().describe('Path to log file'),
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info').describe('Log level'),
    enableFileLogging: z.boolean().default(true).describe('Enable file logging'),
}).optional().describe('Logger configuration');

// Add to AgentConfigSchema
export const AgentConfigSchema = z.object({
    agentCard: AgentCardSchema.optional(),
    systemPrompt: SystemPromptConfigSchema,
    mcpServers: McpServersConfigSchema,
    llm: LLMConfigSchema,
    logger: LoggerConfigSchema,  // ← NEW
    storage: StorageSchema,
    sessions: SessionConfigSchema,
    toolConfirmation: ToolConfirmationConfigSchema,
    telemetry: OtelConfigurationSchema,
}).strict();
```

#### Phase 2: CLI Config Enrichment

**packages/cli/src/config/enrichment.ts** (new file)
```typescript
import { getDextoPath, getExecutionContext } from '@dexto/agent-management';
import type { AgentConfig } from '@dexto/core';
import path from 'path';

export function enrichAgentConfig(
    agentId: string,
    userConfig: Partial<AgentConfig>
): AgentConfig {
    const context = getExecutionContext();
    const basePath = getDextoPath(context);

    return {
        ...userConfig,

        // Logger config with per-agent isolation
        logger: {
            logPath: path.join(basePath, 'logs', agentId, 'dexto.log'),
            level: 'info',
            enableFileLogging: true,
            ...userConfig.logger,
        },

        // Storage config with per-agent isolation
        storage: {
            cache: {
                type: 'in-memory',
                ...userConfig.storage?.cache,
            },
            database: {
                type: 'sqlite',
                path: path.join(basePath, 'database'),
                database: `${agentId}.db`,
                ...userConfig.storage?.database,
            },
            blob: {
                type: 'local',
                storePath: path.join(basePath, 'data', `blobs-${agentId}`),
                maxBlobSize: 52428800, // 50MB
                maxTotalSize: 1073741824, // 1GB
                cleanupAfterDays: 30,
                ...userConfig.storage?.blob,
            },
        },

        // Other required fields
        llm: userConfig.llm!,
        systemPrompt: userConfig.systemPrompt!,
        mcpServers: userConfig.mcpServers || {},
        sessions: userConfig.sessions || {
            maxSessions: 100,
            sessionTTL: 3600000,
        },
        toolConfirmation: userConfig.toolConfirmation || {
            enabled: false,
        },
        telemetry: userConfig.telemetry || {
            metrics: { enabled: false },
            logs: { enabled: false },
            traces: { enabled: false },
        },
    } as AgentConfig;
}
```

Enrichment rules and guardrails:
- Do not override user-specified values. Enrichment must only fill missing fields; if the user provided `logger.logPath`, `storage.database.path`, `storage.database.database`, or `storage.blob.storePath`, preserve them as-is.
- Normalize and expand paths cross‑platform. Handle `~` expansion on Unix and `%USERPROFILE%` on Windows; fall back to `process.env.HOME`/`USERPROFILE` as needed. Use `path.resolve` with explicit base directories.
- Keep defaults per‑agent. All default paths should include the derived `agentId` to guarantee isolation by default.
- Validate after enrichment. Run schema validation post‑enrichment to surface precise errors (e.g., missing required paths for sqlite/local backends).
- Tests: include cases that (a) confirm user overrides win over defaults, (b) Windows and Unix path normalization, and (c) per‑agent isolation directories are respected.

#### Phase 3: Remove Core Path Fallbacks

**packages/core/src/logger/logger.ts**
```typescript
// BEFORE:
this.logFilePath = getDextoPath('logs', 'dexto.log');

// AFTER:
this.logFilePath = config.logPath; // Config is now required!
```

**packages/core/src/storage/database/sqlite-store.ts**
```typescript
// BEFORE:
const storageDir = getDextoPath('database');
const finalPath = path.join(storageDir, dbName);

// AFTER:
if (!config.path) {
    throw new StorageError('SQLite database path is required in config');
}
const finalPath = path.join(config.path, dbName);
```

**packages/core/src/storage/blob/local-blob-store.ts**
```typescript
// BEFORE:
const blobSubdir = this.agentId ? `blobs-${this.agentId}` : 'blobs';
this.storePath = config.storePath || getDextoPath('data', blobSubdir);

// AFTER:
if (!config.storePath) {
    throw new StorageError('Blob storage path is required in config');
}
this.storePath = config.storePath;
```

Additional considerations:
- Make `database.path` required in the schema when `type === 'sqlite'` and `blob.storePath` required when `type === 'local'`; add unit tests for these invariants.
- Document SQLite concurrency expectations (single‑writer, multiple readers). For multi‑process agents, recommend Postgres or another remote DB in docs.

#### Phase 4: Move Path Utils Out of Core

Move these files from `packages/core/src/utils/` to `@dexto/agent-management`:
- `path.ts` - Context-aware path resolution
- `execution-context.ts` - Execution context detection

Update imports in CLI and other consuming packages.

#### Phase 5: Update CLI to Use Enrichment

**packages/cli/src/cli/utils/agent-loader.ts**
```typescript
import { enrichAgentConfig } from '../../config/enrichment.js';
import { Dexto, deriveDisplayName } from '@dexto/agent-management';

export async function loadAgentFromConfig(
    configPath: string
): Promise<DextoAgent> {
    // Load raw config from YAML
    const rawConfig = await loadConfigFile(configPath);

    // Derive agent ID
    const agentId = deriveDisplayName(
        rawConfig.agentCard?.name ||
        path.basename(configPath, path.extname(configPath))
    );

    // Enrich config with CLI defaults
    const enrichedConfig = enrichAgentConfig(agentId, rawConfig);

    // Create agent with enriched config
    const dexto = new Dexto();
    return dexto.agent(enrichedConfig, configPath);
}
```

## Implementation Plan

### Step 1: Add Logger Config (Breaking Change)
- [x] Add `LoggerConfigSchema` to `packages/core/src/agent/schemas.ts` ✅
- [x] Logger config exists with transports system (file, console, remote)
- [ ] Update `Logger` class to accept config in constructor (existing transports work)
- [ ] Update `createAgentServices()` to pass logger config (partial - enrichment adds file transport)
- [x] Add logger section to `agents/default-agent.yml` ✅
- [x] Update tests for logger with config ✅

### Step 2: Create Config Enrichment Layer (New Feature) ✅ **COMPLETED**
- [x] Create `packages/cli/src/config/config-enrichment.ts` ✅
- [x] Implement `enrichAgentConfig()` with per-agent paths ✅
- [x] Implement `deriveAgentId()` for per-agent isolation ✅
- [x] Add tests for enrichment logic (14 tests covering all scenarios) ✅
- [x] Enrichment respects user overrides (doesn't overwrite explicit configs) ✅
- [x] Enrichment provides filesystem storage when storage missing ✅
- [x] Enrichment enriches empty paths for SQLite and local blob ✅
- [ ] Document enrichment behavior (needs docs update)

### Step 2a: InMemoryBlobStore Implementation (Bonus) ✅ **COMPLETED**
- [x] Implement InMemoryBlobStore class (~400 LOC) ✅
- [x] Content-based deduplication using SHA-256 ✅
- [x] Size limits (10MB per blob, 100MB total) ✅
- [x] Multi-format retrieval (base64, buffer, stream, data URI) ✅
- [x] MIME type detection via magic numbers ✅
- [x] Update blob factory to create InMemoryBlobStore ✅
- [x] Set in-memory blob as schema default ✅
- [x] CLI enrichment overrides with local blob storage ✅

### Step 2b: Schema Standardization (Bonus) ✅ **COMPLETED**
- [x] Fixed `internalTools` to have `.default([])` ✅
- [x] Standardized method chaining: `.describe().optional()` or `.describe().default()` ✅
- [x] Organized schema into semantic categories (required, optional, defaults) ✅
- [x] Self-documenting code structure ✅

### Step 3: Remove Core Path Fallbacks (Breaking Change)
- [x] Storage schema now has in-memory defaults ✅
- [x] Storage.blob defaults to in-memory (CLI provides local+path) ✅
- [x] Storage.database defaults to in-memory (CLI provides sqlite+path) ✅
- [ ] Remove `getDextoPath()` calls from LocalBlobStore (old fallback code still exists)
- [ ] Remove `getDextoPath()` calls from Logger (needs refactor)
- [x] Add validation via schema (paths required for local/sqlite types) ✅
- [x] Update service tests to provide explicit paths ✅

### Step 4: Update CLI to Use Enrichment (Integration) ✅ **COMPLETED**
- [x] Created `config-enrichment.ts` with `enrichAgentConfig()` and `deriveAgentId()` ✅
- [x] Update API server initialization to use enrichment ✅
- [x] Agent ID derivation works correctly (agentCard.name > filename > default) ✅
- [x] Enrichment provides per-agent paths (logs, database, blobs) ✅
- [ ] Test with all execution contexts (source, project, global) - needs verification

### Step 5: Move Path Utils Out of Core (Cleanup)
- [x] `path.ts` moved to `@dexto/agent-management` ✅ (already done in previous work)
- [x] `execution-context.ts` moved to `@dexto/agent-management` ✅ (already done)
- [x] Update imports in CLI ✅ (already done)
- [x] Remove from core exports ✅ (already done)
- [ ] Update documentation

### Step 6: Filesystem Service & API Key Store (Future)
- [ ] Add config for filesystem backup path
- [ ] Consider moving API key management to CLI/agent-management
- [ ] Evaluate if these should remain in core at all

## Progress Update (December 2024)

### Completed Work

**Session Date: 2024-12-06**

Completed major portions of Steps 2, 3, and 4 with bonus work on schema standardization and in-memory storage:

#### 1. Config Enrichment Layer (Step 2) ✅
- Implemented `packages/cli/src/config/config-enrichment.ts`
- Created `enrichAgentConfig()` function that:
  - Provides filesystem-based storage when user doesn't specify storage
  - Enriches empty paths for SQLite database and local blob storage
  - Respects user's explicit configurations (doesn't override)
  - Adds per-agent file transport to logger
- Created `deriveAgentId()` function with priority:
  1. `agentCard.name` (sanitized for filesystem)
  2. Filename (without extension, skips generic names)
  3. `'default-agent'` fallback
- Added 14 comprehensive unit tests covering:
  - Agent ID derivation with all priority levels
  - Storage enrichment scenarios (missing, partial, full)
  - Logger enrichment (file transport addition)
  - Path generation with getDextoPath integration
  - Config immutability guarantees

**Commits:**
- `fix: make storage required in schema and always provided by enrichment`
- `fix: add storage to validAgentConfig test helper`
- `fix: mock @dexto/agent-management in env tests`
- `fix: handle undefined storage fields safely in enrichment`

#### 2. InMemoryBlobStore Implementation (Bonus) ✅
- Created `packages/core/src/storage/blob/memory-blob-store.ts` (~400 LOC)
- Features:
  - Content-based deduplication using SHA-256 hashing
  - Configurable size limits (10MB per blob, 100MB total by default)
  - Multi-format retrieval: base64, buffer, stream, data URIs
  - MIME type detection via magic numbers and file extensions
  - Automatic cleanup of old blobs
  - No filesystem coupling (perfect for dev/test)
- Updated blob factory to support in-memory type
- Set in-memory blob as schema default
- CLI enrichment automatically overrides to local blob with per-agent paths

**Memory Usage Analysis:**
- Typical file prompts: ~50 KB
- With custom prompt attachments: ~2.5 MB
- With moderate image use: ~22 MB
- Limit approached at ~85 MB (40+ large images)

**Commit:**
- `feat: implement InMemoryBlobStore and set as schema default`

#### 3. Schema Standardization (Bonus) ✅
- Standardized all AgentConfigSchema field definitions
- Fixed `internalTools` to have `.default([])` (was missing modifier)
- Unified method chaining order: `.describe().optional()` or `.describe().default()`
- Organized fields into semantic categories:
  - **Required**: systemPrompt, llm
  - **Optional**: agentCard, greeting, telemetry
  - **Defaults**: mcpServers, internalTools, logger, storage, sessions, toolConfirmation, internalResources, starterPrompts, plugins
- Improved code readability and maintainability

**Commit:**
- `refactor: standardize AgentConfigSchema field definitions`

#### 4. Storage Schema Defaults (Step 3 Partial) ✅
- Storage now defaults to full in-memory configuration:
  ```typescript
  storage: StorageSchema.default({
      cache: { type: 'in-memory' },
      database: { type: 'in-memory' },
      blob: { type: 'in-memory' },
  })
  ```
- Eliminates filesystem coupling for development and testing
- CLI enrichment provides production-ready filesystem storage
- Clean separation: in-memory for dev, filesystem for prod

#### 5. Test Fixes ✅
- Fixed 17 failing storage schema tests by adding blob config
- Fixed env tests by mocking @dexto/agent-management
- Updated agent schema tests to provide storage
- All 1088 unit tests passing

**Quality Checks:** All passing ✅
- ✅ Build passed
- ✅ Tests passed (1088/1088)
- ✅ Lint passed
- ✅ Typecheck passed

### Remaining Work

**Step 3: Remove Core Path Fallbacks**
- [ ] Remove old `getDextoPath()` fallback code from LocalBlobStore
- [ ] Refactor Logger to eliminate `getDextoPath()` usage
- [ ] Validate all services now use config-provided paths exclusively

**Documentation**
- [ ] Document enrichment behavior and user override patterns
- [ ] Update migration guide with new enrichment layer
- [ ] Add examples of different storage configurations
- [ ] Document in-memory blob store limitations and use cases

**Testing**
- [ ] Test CLI with all execution contexts (source, project, global)
- [ ] Integration tests for enrichment layer
- [ ] Manual testing with different agent configurations

**Future Work (Step 6)**
- [ ] Add config for filesystem backup path
- [ ] Evaluate API key management location (CLI vs core)

## Testing Strategy

### Unit Tests
- Logger with explicit config
- SQLite store with explicit path
- Blob store with explicit storePath
- Config enrichment with various agent IDs
- Validation errors when paths are missing
- Cross‑platform path normalization (Unix + Windows) and tilde expansion
- Ensure user overrides are not overwritten by enrichment

### Integration Tests
- CLI loading agent with enriched config
- API server with enriched config
- Multiple agents with isolated paths
- Different execution contexts (source, project, global)

### Manual Testing
- Create agent via CLI in all three contexts
- Verify log files in per-agent directories
- Verify database files have agent ID in name
- Verify blob storage uses per-agent directory
- Test with custom paths in YAML

## Migration Path for Users

### Current Behavior (Pre-Migration)
```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

# Paths are implicit - core decides everything
```

### New Behavior (Post-Migration)

**Option 1: Let CLI decide (recommended)**
```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

# CLI enriches config with:
# - logger.logPath: ~/.dexto/logs/my-agent/dexto.log
# - storage.database.path: ~/.dexto/database
# - storage.database.database: my-agent.db
# - storage.blob.storePath: ~/.dexto/data/blobs-my-agent
```

**Option 2: Explicit paths (advanced)**
```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

logger:
  logPath: /custom/logs/my-agent.log
  level: debug

storage:
  database:
    type: sqlite
    path: /custom/database
    database: my-agent.db
  blob:
    type: local
    storePath: /custom/blobs
```

Notes:
- When explicit paths are provided, the CLI should not override them during enrichment.

**Option 3: Programmatic (future code-first API)**
```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: process.env.OPENAI_API_KEY,
    },
    logger: {
        logPath: './logs/my-agent.log',
    },
    storage: {
        database: {
            type: 'sqlite',
            path: './database',
            database: 'my-agent.db',
        },
    },
});
```

## Open Questions

1. **API Key Store**: Should this move entirely out of core? It's currently writing .env files.
   - **Option A**: Keep in core but make path configurable
   - **Option B**: Move to CLI/agent-management entirely
   - **Recommendation**: Option B - this is a development-time concern

2. **Filesystem Service**: Currently uses `getDextoPath('backups')` with no agent isolation.
   - **Option A**: Add backup config to schema
   - **Option B**: Move backup functionality to CLI
   - **Recommendation**: Option A - backups are a runtime feature

3. **Backward Compatibility**: How do we handle existing deployments?
   - **Option A**: Major version bump (breaking change)
   - **Option B**: Auto-migration script for existing configs
   - **Option C**: Deprecation warnings for one version
   - **Recommendation**: Option A + B - breaking change with migration script

4. **Code-First API**: Should we support Mastra-like TypeScript-first config?
   - **Pros**: Better TypeScript DX, familiar pattern for developers
   - **Cons**: Additional API surface to maintain, complexity
   - **Recommendation**: Future enhancement after core migration is stable

5. **Serverless Storage**: What about serverless environments that need remote storage?
   - Current: SQLite and local blob storage
   - Future: Postgres, S3, etc. already supported via config
   - **Recommendation**: Document serverless patterns with remote storage

## Success Criteria

- [ ] Core package has no `getDextoPath()` imports
- [ ] All services accept explicit paths via config
- [ ] Logger is fully configurable
- [ ] CLI enriches config with per-agent defaults
- [ ] All existing tests pass
- [ ] New tests cover enrichment and validation
- [ ] Documentation updated
- [ ] Migration guide for users
- [ ] All three execution contexts work correctly

## Related Files

- `packages/core/src/agent/schemas.ts` - Schema definitions
- `packages/core/src/utils/service-initializer.ts` - Service creation
- `packages/core/src/utils/path.ts` - Path utilities (to be moved)
- `packages/core/src/utils/execution-context.ts` - Context detection (to be moved)
- `packages/core/src/logger/logger.ts` - Logger implementation
- `packages/core/src/storage/database/sqlite-store.ts` - SQLite storage
- `packages/core/src/storage/blob/local-blob-store.ts` - Blob storage
- `packages/cli/src/cli/utils/agent-loader.ts` - CLI agent loading
- `packages/cli/src/api/server.ts` - API server initialization
- `agents/default-agent.yml` - Example configuration

## Timeline Estimate

- **Step 1** (Logger config): 4-6 hours
- **Step 2** (Enrichment layer): 6-8 hours
- **Step 3** (Remove fallbacks): 8-10 hours
- **Step 4** (CLI integration): 4-6 hours
- **Step 5** (Move utils): 2-4 hours
- **Step 6** (Filesystem/API keys): 4-6 hours

**Total: 28-40 hours** (~1 week of focused work)

## References

- Original discussion: Context from architectural review
- Mastra comparison: `../mastra/packages/core/src/agent/agent.ts`
- Current config: `agents/default-agent.yml`
- Schema source: `packages/core/src/agent/schemas.ts`
