# Instance-First Architecture: Comprehensive Trade-Off Analysis

## Summary of Proposed Change

**Current Architecture (Config-First):**
- Core services accept configuration objects
- Core validates configs with Zod schemas
- Core creates service instances from validated configs
- Both CLI and library users pass config objects

**Proposed Architecture (Instance-First):**
- Core services accept instances that implement interfaces
- CLI validates YAML configs, creates instances, passes to core
- Library users create instances directly in TypeScript
- Core has no config parsing/validation logic

---

## Module-by-Module Impact Analysis

### 1. LLM Module (`packages/core/src/llm/`)

**Current State:**
- Complex LLM registry with provider/model validation
- Provider resolution logic
- Model compatibility checking
- API key validation and environment variable resolution
- Dynamic model switching with validation
- Default model selection per provider

**Proposed Changes:**

**Interface:**
```typescript
export interface ILLMClient {
  generate(messages: Message[], options?: GenerateOptions): Promise<LLMResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<LLMChunk>;
  getProviderInfo(): { provider: string; model: string };
}
```

**Factory Functions (in core for library users):**
```typescript
export function openai(model: string, options: OpenAIOptions): ILLMClient {
  return new OpenAIClient(model, options);
}

export function anthropic(model: string, options: AnthropicOptions): ILLMClient {
  return new AnthropicClient(model, options);
}
```

**Impact:**
- **HIGH** - Major refactor required
- **Validation concern**: Library users can create clients with invalid models/API keys
- **Registry question**: Does LLM_REGISTRY stay in core or move to CLI?
- **Switching complexity**: `switchLLM()` would accept new instance, but loses validation capabilities

**Critical Questions:**
1. **Where does model validation happen?** Currently `resolveAndValidateLLMConfig()` checks if 'gpt-5-mini' is valid for 'openai'. If library user creates `openai('typo-model')`, when do we catch this?
2. **Dynamic switching**: `await agent.switchLLM({ provider: 'anthropic' })` - do we still accept config here? If yes, core still needs validation logic.
3. **Provider features**: OpenAI supports function calling, some models don't. How do we validate feature usage?

---

### 2. Storage Module (`packages/core/src/storage/`)

**Current State:**
- `StorageManager` accepts `StorageConfig` with database/cache/blob configs
- Creates appropriate implementations based on `type` discriminator
- Per-agent path isolation
- Database schema initialization
- Cache TTL management

**Proposed Changes:**

**Interfaces:**
```typescript
export interface IDatabase {
  query(sql: string, params: any[]): Promise<any[]>;
  execute(sql: string, params: any[]): Promise<void>;
  transaction<T>(fn: (tx: ITransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface IBlobStore {
  save(key: string, data: Buffer, metadata?: Record<string, any>): Promise<void>;
  get(key: string): Promise<{ data: Buffer; metadata: Record<string, any> } | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
```

**Factory Functions:**
```typescript
export function sqlite(options: { path: string; database: string }): IDatabase {
  return new SQLiteDatabase(options);
}

export function postgres(options: { connectionString: string }): IDatabase {
  return new PostgresDatabase(options);
}

export function redis(options: { url: string }): ICache {
  return new RedisCache(options);
}

export function local(options: { storePath: string }): IBlobStore {
  return new LocalBlobStore(options);
}
```

**DextoAgent Constructor:**
```typescript
const agent = new DextoAgent({
  database: sqlite({ path: './data', database: 'agent.db' }),
  cache: inMemory(),
  blobStore: local({ storePath: './blobs' })
});
```

**Impact:**
- **HIGH** - Major refactor needed
- **Path isolation**: CLI must handle per-agent paths, not core
- **Schema initialization**: Who runs migrations? Constructor or separate init?
- **Cleaner separation**: Actually makes sense - storage is a natural abstraction

**Trade-offs:**
- ✅ **PRO**: Clean abstraction, easy to add new storage backends
- ✅ **PRO**: Library users can bring their own storage (existing DB connection pool)
- ❌ **CON**: Per-agent isolation logic moves to CLI (duplication if multiple CLIs)
- ❌ **CON**: Schema management becomes CLI responsibility

---

### 3. MCP Module (`packages/core/src/mcp/`)

**Current State:**
- Accepts `McpServersConfig` with stdio/http/sse server definitions
- Creates appropriate MCP clients based on `type` discriminator
- Manages server lifecycle (start/stop/reconnect)
- Dynamic server addition/removal
- Tool aggregation from multiple servers

**Proposed Changes:**

**Interface:**
```typescript
export interface IMCPServer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: any): Promise<any>;
  isConnected(): boolean;
}
```

**Factory Functions:**
```typescript
export function mcpStdio(options: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): IMCPServer {
  return new MCPStdioServer(options);
}

export function mcpHttp(options: { url: string }): IMCPServer {
  return new MCPHttpServer(options);
}
```

**Usage:**
```typescript
const agent = new DextoAgent({
  mcpServers: {
    filesystem: mcpStdio({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    }),
    github: mcpHttp({ url: 'http://localhost:3000' })
  }
});
```

**Impact:**
- **MEDIUM-HIGH** - Significant refactor
- **Dynamic addition**: `await agent.connectMcpServer('name', mcpStdio(...))` - this actually works well!
- **Lifecycle management**: Interface allows core to manage lifecycle without knowing implementation

**Trade-offs:**
- ✅ **PRO**: Clean abstraction, easy to add transport types
- ✅ **PRO**: Dynamic server management works naturally
- ✅ **PRO**: Users can implement custom MCP transports
- ❌ **CON**: Users must import and understand transport types (MCPStdioServer, MCPHttpServer)
- ⚠️ **NEUTRAL**: Not much validation needed here anyway

---

### 4. Config Loader (`packages/core/src/config/`)

**Current State:**
- `loadAgentConfig()` - loads YAML files
- `loadEnvironmentVariables()` - resolves env vars
- Validates with Zod schemas
- Applies defaults
- Returns `ValidatedAgentConfig`

**Proposed Changes:**
- **ENTIRE MODULE MOVES TO CLI**
- Core no longer loads configs
- Core no longer knows about YAML

**Impact:**
- **VERY HIGH** - Fundamental architectural change
- **Breaking change**: `loadAgentConfig` was exported, users may use it

**Critical Decision:**
Where do Zod schemas live if loader moves to CLI?

**Option A: Schemas stay in core**
- CLI imports schemas from core
- Types remain accessible to library users
- Core has schemas but doesn't use them (weird)

**Option B: Schemas move to CLI**
- Library users can't import config types
- Or we export types without schemas? TypeScript types can't be derived anymore

**Option C: New package `@dexto/schemas`**
- Both core and CLI depend on it
- Adds complexity
- Clear separation of concerns

---

### 5. Agent Schemas (`packages/core/src/agent/schemas.ts`)

**Current State:**
- Master Zod schemas for all config
- Types derived from schemas: `type LLMConfig = z.infer<typeof LLMConfigSchema>`
- Used throughout core for validation
- ~500 lines of complex Zod definitions

**Proposed Changes:**
**THIS IS THE BIGGEST QUESTION**

**Scenario 1: Schemas move to CLI**
```typescript
// @dexto/cli/schemas.ts - Zod schemas
// @dexto/core/types.ts - Plain TypeScript types

// Problem: How do we keep types in sync?
// Problem: Can't derive types from schemas anymore
```

**Scenario 2: Schemas stay in core (unused)**
```typescript
// @dexto/core/schemas.ts - Zod schemas (for CLI to import)
// @dexto/core/types.ts - Types derived from schemas

// Core exports schemas but doesn't use them
// CLI imports and uses them
// Weird dependency direction
```

**Scenario 3: Duplicate schemas**
```typescript
// @dexto/core/types.ts - TypeScript interfaces
// @dexto/cli/schemas.ts - Zod schemas matching interfaces

// Manual sync required
// DRY violation
// Error-prone
```

**Impact:**
- **VERY HIGH** - Affects entire codebase
- **TypeScript limitation**: Can't derive types without schemas
- **Maintenance burden**: Keeping types/schemas in sync

---

### 6. Logger Module (`packages/core/src/logger/`)

**Current State:**
- Singleton logger with hardcoded path
- No configuration
- Needs refactor anyway (per our logger refactor plan)

**Proposed Changes:**

**Interface:**
```typescript
export interface ILogger {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, context?: Record<string, any>): void;
}
```

**Factory:**
```typescript
export function logger(options: {
  level: LogLevel;
  transports: LoggerTransport[];
}): ILogger {
  return new DextoLogger(options);
}
```

**Impact:**
- **MEDIUM** - Aligns perfectly with our logger refactor plan!
- This change actually HELPS our logger architecture

**Trade-offs:**
- ✅ **PRO**: Forces us to fix logger architecture
- ✅ **PRO**: Per-agent loggers become natural
- ✅ **PRO**: Users can inject custom loggers

---

### 7. Session Module (`packages/core/src/session/`)

**Current State:**
- Accepts simple `SessionConfig` (maxSessions, sessionTTL)
- Creates `SessionManager` with storage dependency

**Proposed Changes:**

**This is where it gets weird - what about simple config values?**

**Option A: Everything becomes instances (awkward)**
```typescript
const agent = new DextoAgent({
  sessionManager: new SessionManager({
    maxSessions: 100,
    sessionTTL: 3600000
  }, database)
});
// Awkward - users must create SessionManager manually
```

**Option B: Hybrid - instances for complex, config for simple**
```typescript
const agent = new DextoAgent({
  database: sqlite({ path: './data' }),  // Instance
  sessions: {                             // Config
    maxSessions: 100,
    sessionTTL: 3600000
  }
});
// Agent creates SessionManager internally from simple config + database
```

**Option C: Builder pattern**
```typescript
const agent = new DextoAgent({
  database: sqlite({ path: './data' }),
  sessions: sessionConfig({ maxSessions: 100 })  // Returns SessionOptions object
});
```

**Impact:**
- **MEDIUM** - Design decision affects user DX
- **Hybrid approach makes most sense** - don't force instances for simple values

---

### 8. Telemetry Module (`packages/core/src/telemetry/`)

**Current State:**
- Accepts `TelemetryConfig` (enabled, endpoint, sampling, etc.)
- Initializes OpenTelemetry SDK
- Decorates classes with tracing

**Proposed Changes:**

Similar to sessions - telemetry is mostly configuration:

**Option A: Instance**
```typescript
const agent = new DextoAgent({
  telemetry: new Telemetry({
    enabled: true,
    endpoint: 'http://localhost:4318'
  })
});
```

**Option B: Config (simpler)**
```typescript
const agent = new DextoAgent({
  telemetry: {
    enabled: true,
    endpoint: 'http://localhost:4318'
  }
});
```

**Impact:**
- **LOW-MEDIUM** - Telemetry is more config than service
- **Recommendation**: Keep as config object, not instance

---

### 9. Tool Module / System Prompt / Approval / Resource / Search / Memory / Plugins

**Current State:**
- Most are internal services that users don't interact with directly
- Created automatically from other dependencies
- Some accept simple configs

**Proposed Changes:**
- **Internal services should NOT be exposed in constructor**
- Created automatically from the services users DO provide
- Example: ToolManager needs MCPManager, created internally

**Impact:**
- **LOW** - These are implementation details
- Users should never construct ToolManager, ResourceManager, etc.

---

## Critical Trade-Off Analysis

### Trade-Off 1: Validation Location

**Current: Config validation in core**
```typescript
const agent = new DextoAgent({
  llm: { provider: 'invalid-provider', model: 'gpt-5' }
});
// Error immediately: Invalid provider 'invalid-provider'. Must be one of: openai, anthropic, ...
```

**Proposed: Validation in CLI only**
```typescript
// CLI: validates YAML → creates instances
// Library user: no validation
const llm = openai('typo-model', { apiKey: '' });  // No error!
const agent = new DextoAgent({ llm });              // No error!
await agent.run('test');                            // Error at runtime: Invalid model
```

**Analysis:**
- ❌ **Major loss**: Library users lose compile-time/construction-time validation
- ❌ **Runtime errors**: Failures happen later, harder to debug
- ❌ **Worse DX**: TypeScript can't validate string literals like 'gpt-5-mini'
- ⚠️ **Workaround**: Add validation to factory functions, but then core still has validation logic

**Severity**: **CRITICAL** - This is a major regression in developer experience

---

### Trade-Off 2: Where Do Schemas Live?

**Option A: Schemas in core (unused by core)**
```typescript
// @dexto/core/schemas.ts
export const LLMConfigSchema = z.object({...});
export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// @dexto/core/llm/client.ts
export class OpenAIClient implements ILLMClient {
  // Doesn't use schema
}

// @dexto/cli/factories.ts
import { LLMConfigSchema } from '@dexto/core/schemas.js';
const validated = LLMConfigSchema.parse(yamlConfig.llm);
```

**Analysis:**
- ✅ **PRO**: Types remain in core, library users can import
- ✅ **PRO**: Single source of truth for types
- ❌ **CON**: Core exports schemas it doesn't use (architectural smell)
- ❌ **CON**: Core still depends on Zod (no bundle size win)

**Option B: Schemas in CLI**
```typescript
// @dexto/cli/schemas.ts
export const LLMConfigSchema = z.object({...});

// @dexto/core/types.ts
export interface LLMConfig {  // Manual definition
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;
}
```

**Analysis:**
- ✅ **PRO**: Core doesn't depend on Zod (smaller bundle)
- ❌ **CON**: Manual sync between schemas and types (error-prone)
- ❌ **CON**: Lose automatic type derivation
- ❌ **CON**: Library users can't import validated types

**Option C: New package `@dexto/schemas`**
```typescript
// @dexto/schemas/llm.ts
export const LLMConfigSchema = z.object({...});
export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// @dexto/core depends on @dexto/schemas (for types)
// @dexto/cli depends on @dexto/schemas (for validation)
```

**Analysis:**
- ✅ **PRO**: Clean separation of concerns
- ✅ **PRO**: Both core and CLI use same source
- ❌ **CON**: Extra package to maintain
- ❌ **CON**: Core still transitively depends on Zod
- ⚠️ **NEUTRAL**: More architectural complexity

**Severity**: **HIGH** - No good answer, all options have downsides

---

### Trade-Off 3: API Complexity for Library Users

**Current: Simple config object**
```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
  storage: {
    database: { type: 'sqlite', path: './data' },
    cache: { type: 'in-memory' }
  },
  systemPrompt: 'You are helpful'
});
```

**Proposed: Factory functions + instances**
```typescript
import { openai } from '@dexto/llm';
import { sqlite, inMemory, local } from '@dexto/storage';
import { logger, consoleTransport, fileTransport } from '@dexto/logger';

const agent = new DextoAgent({
  name: 'my-agent',
  systemPrompt: 'You are helpful',
  llm: openai('gpt-5-mini', { apiKey: '...' }),
  database: sqlite({ path: './data', database: 'agent.db' }),
  cache: inMemory(),
  blobStore: local({ storePath: './blobs' }),
  logger: logger({
    level: 'info',
    transports: [
      consoleTransport(),
      fileTransport({ path: './logs/app.log' })
    ]
  })
});
```

**Analysis:**
- ❌ **CON**: More imports required
- ❌ **CON**: More ceremony for simple cases
- ✅ **PRO**: More explicit, better autocomplete
- ✅ **PRO**: Easier to see what's happening
- ⚠️ **NEUTRAL**: Depends on user preference

**Severity**: **MEDIUM** - Subjective, but definitely more code to write

---

### Trade-Off 4: Dynamic LLM Switching

**Current:**
```typescript
await agent.switchLLM({
  provider: 'anthropic',
  model: 'claude-3-opus'
});
// Core validates: Is 'anthropic' valid? Is 'claude-3-opus' valid for anthropic?
```

**Proposed Option A: Accept instance**
```typescript
await agent.switchLLM(anthropic('claude-3-opus', { apiKey: '...' }));
// No validation - user creates instance
```

**Proposed Option B: Still accept config**
```typescript
await agent.switchLLM({
  provider: 'anthropic',
  model: 'claude-3-opus'
});
// But wait - if we still accept config, core needs validation logic!
// Haven't achieved the goal of removing config from core
```

**Analysis:**
- ❌ **Problem**: If `switchLLM` accepts config, core still needs LLM registry and validation
- ❌ **Problem**: If `switchLLM` accepts instance, users must manually create clients
- ❌ **Blocker**: This feature fundamentally needs config-to-instance conversion

**Severity**: **CRITICAL** - Dynamic switching is a core feature, this breaks the abstraction

---

### Trade-Off 5: Default Values & Conveniences

**Current:**
```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai' }  // model defaults to gpt-5-mini
});
```

**Proposed:**
```typescript
const agent = new DextoAgent({
  llm: openai()  // What's the default model? Constructor decides? No model?
});
```

**Analysis:**
- ❌ **Lost**: Smart defaults based on provider (each provider has different default)
- ❌ **Lost**: Environment-based defaults (development vs production)
- ❌ **Workaround**: Each factory function needs default logic (duplication)

**Severity**: **MEDIUM** - Loses convenience, but not fundamental

---

### Trade-Off 6: Cross-Field Validation

**Current:**
```typescript
const agent = new DextoAgent({
  telemetry: { enabled: true },  // Missing endpoint!
  // Error: telemetry.endpoint is required when enabled is true
});
```

**Proposed:**
```typescript
const agent = new DextoAgent({
  telemetry: { enabled: true }  // No endpoint check until runtime
});
```

**Analysis:**
- ❌ **Lost**: Cross-field validation
- ❌ **Lost**: Dependency checks (if A enabled, B required)
- ⚠️ **Workaround**: Validate in constructor, but that's not "instance-first"

**Severity**: **MEDIUM** - Loses correctness guarantees

---

### Trade-Off 7: CLI Implementation Complexity

**Current CLI:**
```typescript
export async function loadAgentFromConfig(configPath: string) {
  const config = await loadConfigFile(configPath);  // 1 line
  const agent = new DextoAgent(config, configPath);  // 1 line
  await agent.start();
  return agent;
}
```

**Proposed CLI:**
```typescript
export async function loadAgentFromConfig(configPath: string) {
  const yamlConfig = await loadConfigFile(configPath);
  const agentId = deriveAgentId(yamlConfig, configPath);

  // Create all instances from config (20+ lines of factory calls)
  const agent = new DextoAgent({
    name: agentId,
    systemPrompt: yamlConfig.systemPrompt,
    llm: createLLMClient(yamlConfig.llm),
    database: createDatabase(yamlConfig.storage.database, agentId),
    cache: createCache(yamlConfig.storage.cache),
    blobStore: createBlobStore(yamlConfig.storage.blob, agentId),
    logger: createLogger(yamlConfig.logger, agentId),
    mcpServers: await createMCPServers(yamlConfig.mcpServers),
    sessions: yamlConfig.sessions,
    telemetry: yamlConfig.telemetry
  });

  await agent.start();
  return agent;
}
```

**Analysis:**
- ❌ **CON**: CLI code grows significantly
- ❌ **CON**: All factory logic moves to CLI
- ❌ **CON**: Per-agent logic (path enrichment) in CLI
- ⚠️ **CONCERN**: If we build other entry points (web framework, discord bot), they all need this logic

**Severity**: **MEDIUM-HIGH** - Increases maintenance burden

---

### Trade-Off 8: Testing

**Current:**
```typescript
// Mock at implementation level
jest.mock('../llm/services/openai', () => ({
  OpenAIService: MockOpenAIService
}));

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: 'test' }
});
```

**Proposed:**
```typescript
// Inject mock directly
const mockLLM: ILLMClient = {
  generate: jest.fn(),
  stream: jest.fn(),
  getProviderInfo: () => ({ provider: 'mock', model: 'mock' })
};

const agent = new DextoAgent({ llm: mockLLM });
```

**Analysis:**
- ✅ **PRO**: Much easier to inject mocks!
- ✅ **PRO**: No module mocking needed
- ✅ **PRO**: Better isolation
- ✅ **WIN**: This is genuinely better for testing

**Severity**: **POSITIVE** - Clear improvement

---

### Trade-Off 9: Breaking Changes

**Current → Proposed:**

Every single library user must update their code:

**Before:**
```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
```

**After:**
```typescript
import { DextoAgent } from '@dexto/core';
import { openai } from '@dexto/llm';

const agent = new DextoAgent({
  llm: openai('gpt-5-mini', { apiKey: process.env.OPENAI_API_KEY })
});
```

**Impact:**
- ❌ **MAJOR BREAKING CHANGE** - No migration path
- ❌ **Documentation**: All examples must be rewritten
- ❌ **User frustration**: Forced upgrade with no benefit for many users
- ⚠️ **Version**: Requires v2.0.0 or later

**Severity**: **CRITICAL** - Large ecosystem impact

---

### Trade-Off 10: Bundle Size

**Current:**
```
@dexto/core includes:
- Zod (~13KB minified)
- All validation logic
- LLM registry
- Config schemas
```

**Proposed:**
```
@dexto/core includes:
- All service implementations
- All interfaces
- Factory functions (if in core)

@dexto/cli includes:
- Zod (~13KB minified)
- All validation logic
- Config factories
```

**Analysis:**
- ✅ **PRO**: Library users don't pay for Zod if they don't use config validation
- ❌ **CON**: But they DO pay for all service implementations (larger)
- ⚠️ **NEUTRAL**: Net effect probably minimal
- ⚠️ **Question**: Do library users actually care about 13KB in a Node.js app?

**Severity**: **LOW** - Negligible difference in practice

---

## The Hybrid Alternative

What if we support BOTH patterns?

```typescript
// Pattern 1: Config (current, still works)
const agent1 = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' }
});

// Pattern 2: Instance (new, opt-in)
const agent2 = new DextoAgent({
  llm: openai('gpt-5-mini', { apiKey: '...' })
});

// Pattern 3: Mixed (best of both)
const agent3 = new DextoAgent({
  llm: openai('gpt-5-mini', { apiKey: '...' }),  // Instance
  sessions: { maxSessions: 100 }                  // Config
});
```

**Implementation:**
```typescript
type LLMInput = LLMConfig | ILLMClient;

class DextoAgent {
  constructor(options: {
    llm: LLMInput;
    // ...
  }) {
    // Normalize input
    this.llm = this.normalizeLLM(options.llm);
  }

  private normalizeLLM(input: LLMInput): ILLMClient {
    if (isLLMClient(input)) {
      return input;  // Already an instance
    } else {
      return createLLMClient(input);  // Create from config
    }
  }
}
```

**Analysis:**
- ✅ **PRO**: No breaking changes
- ✅ **PRO**: Library users get flexibility
- ✅ **PRO**: Config users keep validation
- ❌ **CON**: Core still needs all factory/validation logic
- ❌ **CON**: Doesn't achieve goal of removing config from core
- ⚠️ **QUESTION**: If core still has factories, what have we gained?

**Verdict**: Hybrid approach doesn't achieve the architectural separation goal.

---

## Comparison with Mastra

**Why does instance-first work for Mastra?**

1. **No CLI** - Mastra is library-only, no YAML support
2. **Vercel AI SDK** - Users already have model instances from external SDK
3. **Simpler scope** - Fewer moving parts than Dexto
4. **No dynamic switching** - Doesn't have `switchLLM()` type features
5. **Target audience** - Library-first developers comfortable with code-first

**Why it's harder for Dexto:**

1. **CLI + Library** - Must serve both audiences
2. **Own LLM abstraction** - We create LLM clients, not external SDK
3. **Complex features** - Dynamic switching, provider registry, validation
4. **YAML-first design** - Config is first-class citizen
5. **Broader audience** - CLI users, DevOps, config-driven deployments

**Key insight:** Mastra doesn't have our config→instance conversion problem because **they never had config in the first place**.

---

## Recommended Hybrid Approach: Factory Functions in Core

Instead of full instance-first, provide **opt-in factory functions** while keeping config support:

```typescript
// Current usage (still works)
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' }
});

// New usage (opt-in, no breaking change)
import { llm } from '@dexto/core';

const agent = new DextoAgent({
  llm: llm.openai('gpt-5-mini', { apiKey: '...' })
});
```

**Implementation:**
```typescript
// @dexto/core/llm/factories.ts
export const llm = {
  openai: (model: string, options: OpenAIOptions): ILLMClient => {
    return createLLMClient({ provider: 'openai', model, ...options });
  },
  anthropic: (model: string, options: AnthropicOptions): ILLMClient => {
    return createLLMClient({ provider: 'anthropic', model, ...options });
  }
};
```

**Benefits:**
- ✅ No breaking changes
- ✅ Better DX for library users (optional)
- ✅ Keep validation in core
- ✅ CLI stays simple
- ✅ Factory functions are just sugar over config

**Drawbacks:**
- ⚠️ Doesn't achieve "config-free core" goal
- ⚠️ Still maintaining both patterns

---

## Final Recommendation Matrix

| Aspect | Instance-First | Hybrid (Factory Functions) | Current (Config-Only) |
|--------|----------------|---------------------------|----------------------|
| **Library DX** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **CLI DX** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Validation** | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Breaking Changes** | ❌ Major | ✅ None | ✅ None |
| **Implementation Cost** | ❌ Very High | ⭐⭐⭐⭐ Low | ✅ None |
| **Maintenance Burden** | ❌ High | ⭐⭐⭐ Medium | ⭐⭐⭐⭐⭐ Low |
| **Testing** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Bundle Size** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Achieves Goal** | ✅ Yes | ⚠️ Partial | ❌ No |

---

## My Architectural Recommendation

**Don't do full instance-first.** Here's why:

### Critical Blockers:

1. **Validation Loss**: Library users lose compile-time validation - this is a major DX regression
2. **Schema Location Problem**: No good solution for where Zod schemas live
3. **Dynamic Features**: Features like `switchLLM()` fundamentally need config
4. **Breaking Changes**: Massive ecosystem disruption for unclear benefit
5. **CLI Complexity**: Every entry point (CLI, web, Discord bot) needs complex factory logic

### Instead, I recommend:

**Phase 1: Improve Current Architecture (Small Wins)**
- Add factory functions as syntactic sugar: `llm.openai()`, `storage.sqlite()`
- Keep config as primary API
- Improve TypeScript types and autocomplete
- Better documentation of config options

**Phase 2: Optional Instance Injection (Incremental)**
- Accept `LLMConfig | ILLMClient` (union types)
- Library users can inject instances if they want
- Core normalizes inputs
- No breaking changes

**Phase 3: Interface-Based Mocking (Testing)**
- Export interfaces for all services
- Make mocking easier
- This benefits testing without changing user API

### What You Actually Want (I Think):

You want the **feel** of Mastra's API without giving up Dexto's strengths:

```typescript
import { DextoAgent, llm, storage } from '@dexto/core';

const agent = new DextoAgent({
  name: 'my-agent',
  systemPrompt: 'You are helpful',
  llm: llm.openai('gpt-5-mini'),           // ← Factory function (sugar)
  storage: storage.sqlite({ path: './data' }) // ← Factory function (sugar)
});
```

Internally, these factories create config objects and call existing creation logic. Users get a nicer API, but we keep validation, config support, and avoid breaking changes.

---

## Questions for You

1. **Is the validation loss acceptable?** If library users create `openai('typo-model')`, and we don't catch it until runtime - is that okay?

2. **What about `switchLLM()`?** Should it accept config or instance? If config, then core still needs validation logic.

3. **Breaking changes tolerance?** Is v2.0.0 with major breaking changes acceptable now?

4. **Primary goal?** Is it:
   - Better library DX (factory functions achieve this)
   - Architectural purity (removing config from core)
   - Matching Mastra (different use case)
   - Better testing (interfaces achieve this)

5. **CLI future?** Do you plan to have multiple CLIs (web framework CLI, Discord bot CLI, etc.)? If yes, factory logic duplication becomes a problem.

What are your thoughts on these trade-offs?
