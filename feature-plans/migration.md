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
- [ ] Add `LoggerConfigSchema` to `packages/core/src/agent/schemas.ts`
- [ ] Update `Logger` class to accept config in constructor
- [ ] Update `createAgentServices()` to pass logger config
- [ ] Add logger section to `agents/default-agent.yml`
- [ ] Update tests for logger with config

### Step 2: Create Config Enrichment Layer (New Feature)
- [ ] Create `packages/cli/src/config/enrichment.ts`
- [ ] Implement `enrichAgentConfig()` with per-agent paths
- [ ] Add tests for enrichment logic
- [ ] Document enrichment behavior

### Step 3: Remove Core Path Fallbacks (Breaking Change)
- [ ] Make database.path required when type is 'sqlite'
- [ ] Make blob.storePath required when type is 'local'
- [ ] Remove `getDextoPath()` calls from services
- [ ] Add validation errors for missing paths
- [ ] Update service tests to provide explicit paths

### Step 4: Update CLI to Use Enrichment (Integration)
- [ ] Update `agent-loader.ts` to use `enrichAgentConfig()`
- [ ] Update API server initialization
- [ ] Ensure agent ID derivation works correctly
- [ ] Test with all execution contexts (source, project, global)

### Step 5: Move Path Utils Out of Core (Cleanup)
- [ ] Move `path.ts` to `@dexto/agent-management`
- [ ] Move `execution-context.ts` to `@dexto/agent-management`
- [ ] Update imports in CLI
- [ ] Remove from core exports
- [ ] Update documentation

### Step 6: Filesystem Service & API Key Store (Future)
- [ ] Add config for filesystem backup path
- [ ] Consider moving API key management to CLI/agent-management
- [ ] Evaluate if these should remain in core at all

## Testing Strategy

### Unit Tests
- Logger with explicit config
- SQLite store with explicit path
- Blob store with explicit storePath
- Config enrichment with various agent IDs
- Validation errors when paths are missing

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
