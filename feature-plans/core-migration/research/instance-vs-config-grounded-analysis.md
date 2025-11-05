# Instance vs Config: Grounded Analysis of Dexto's Actual Codebase

## Executive Summary

After systematically reading every schema and module in Dexto's core, here's the reality: **Most of Dexto is already well-served by config**. Only ONE module truly needs instance support: **Plugins**.

---

## Complete Config Inventory (From `packages/core/src/agent/schemas.ts`)

```typescript
export const AgentConfigSchema = z.object({
    agentCard: AgentCardSchema.optional(),
    greeting: z.string().optional(),
    systemPrompt: SystemPromptConfigSchema,
    mcpServers: McpServersConfigSchema.default({}),
    internalTools: InternalToolsSchema,
    llm: LLMConfigSchema,
    storage: StorageSchema.default({...}),
    sessions: SessionConfigSchema.default({}),
    toolConfirmation: ToolConfirmationConfigSchema.default({}),
    internalResources: InternalResourcesSchema.default([]),
    starterPrompts: StarterPromptsSchema.default([]),
    plugins: PluginsConfigSchema.default({}),
    telemetry: OtelConfigurationSchema.optional(),
}).strict();
```

---

## Module-by-Module Reality Check

### 1. ✅ Plugins (`packages/core/src/plugins/`)

**Current Reality:**
```typescript
// packages/core/src/plugins/schemas.ts
export const CustomPluginConfigSchema = z.object({
    name: z.string(),
    module: z.string(),  // ← Points to code file
    enabled: z.boolean().default(true),
    blocking: z.boolean(),
    priority: z.number().int(),
    config: z.record(z.any()).optional(),
});

export const PluginsConfigSchema = z.object({
    contentPolicy: BuiltInPluginConfigSchema.optional(),
    responseSanitizer: BuiltInPluginConfigSchema.optional(),
    custom: z.array(CustomPluginConfigSchema).default([]),
});
```

**Plugin Interface:**
```typescript
// packages/core/src/plugins/types.ts
export interface DextoPlugin {
    initialize?(config: Record<string, any>): Promise<void>;

    beforeLLMRequest?(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    beforeToolCall?(
        payload: BeforeToolCallPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    afterToolResult?(
        payload: AfterToolResultPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    beforeResponse?(
        payload: BeforeResponsePayload,
        context: PluginExecutionContext
    ): Promise<PluginResult>;

    cleanup?(): Promise<void>;
}
```

**Current Usage:**
```yaml
# agents/my-agent.yml
plugins:
  contentPolicy:
    enabled: true
    priority: 10
    blocking: true
  custom:
    - name: my-analytics
      module: ${{dexto.agent_dir}}/plugins/analytics.js
      enabled: true
      blocking: false
      priority: 20
      config:
        apiKey: $ANALYTICS_KEY
```

**What This Means:**
- Plugins ARE ALREADY hybrid: Config points to module, module exports code
- Users write plugins as code (implementing `DextoPlugin`)
- Config controls which plugins load, priority, blocking behavior, per-plugin settings

**Recommendation: ✅ THIS IS PERFECT AS-IS**

The current design is actually ideal:
- Config handles declarative stuff (enabled, priority, module path)
- Code handles behavior (extension point implementations)
- YAML users can reference plugins via module paths
- TypeScript users... also reference plugins via module paths

**The only improvement:** Support instance-based registration for library users

```typescript
// Library usage (new capability)
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    plugins: {
        custom: [
            new MyAnalyticsPlugin(),  // ← Direct instance
            new MyLoggingPlugin()
        ]
    }
});
```

But this is syntactic sugar - internally it would just wrap them in the config format.

---

### 2. ❌ LLM (`packages/core/src/llm/`)

**Current Reality:**
```typescript
// packages/core/src/llm/schemas.ts
export const LLMConfigSchema = z.object({
    provider: z.enum(['openai', 'anthropic', 'google', 'groq', 'openai-compatible']),
    model: z.string(),
    apiKey: z.string(),
    maxIterations: z.number().default(50),
    router: z.enum(['vercel', 'in-built']).default('vercel'),
    baseURL: z.string().url().optional(),
    maxInputTokens: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    temperature: z.number().min(0).max(1).optional(),
    allowedMediaTypes: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
    // Complex validation:
    // - API key validation with provider context
    // - baseURL compatibility checks
    // - Model compatibility checks
    // - Router compatibility checks
});
```

**What Would Instance-First Look Like:**
```typescript
// Hypothetical
const agent = new DextoAgent({
    llm: openai('gpt-5-mini', { apiKey: '...' })
});
```

**The Problem:**
1. **Where does `openai()` live?** In core? Then core still has all the provider logic.
2. **What about validation?** The factory needs to validate model names against registry.
3. **What about `switchLLM()`?** Currently accepts config: `{ provider: 'anthropic', model: 'claude-3-opus' }`. Would need to accept instances, losing validation.

**The Reality:**
- LLM has extensive validation logic tied to provider/model combinations
- Registry of supported providers and models
- Complex cross-field validation (baseURL support, router compatibility)
- Dynamic switching is a core feature

**Recommendation: ❌ STAY CONFIG-BASED**

Config is the right abstraction for LLM because:
- Providers/models are a closed set (we control the registry)
- Validation is critical (invalid model = runtime failure)
- Config switching is a feature (`switchLLM()`)
- Most users use standard providers (OpenAI, Anthropic)

**Possible improvement:** Support custom LLM clients for advanced users
```typescript
// 99% of users
llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: '...'
}

// 1% of users with custom LLM endpoints
llm: new CustomLLMClient({
    endpoint: 'https://my-llm.com',
    async generate(messages) { ... }
})
```

But this is edge case, not worth the architectural cost.

---

### 3. ❌ Storage (`packages/core/src/storage/`)

**Current Reality:**
```typescript
// packages/core/src/storage/schemas.ts
export const StorageSchema = z.object({
    cache: CacheConfigSchema,     // discriminated union: 'in-memory' | 'redis'
    database: DatabaseConfigSchema, // discriminated union: 'in-memory' | 'sqlite' | 'postgres'
    blob: BlobStoreConfigSchema,   // discriminated union: 'in-memory' | 'local'
});

// Database example
export const DatabaseConfigSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('in-memory'),
    }),
    z.object({
        type: z.literal('sqlite'),
        path: z.string().optional(),
        database: z.string().default('dexto.db'),
    }),
    z.object({
        type: z.literal('postgres'),
        connectionString: z.string(),
        ssl: z.boolean().optional(),
    }),
]);
```

**What Would Instance-First Look Like:**
```typescript
// Hypothetical
const agent = new DextoAgent({
    database: new SQLiteDatabase({ path: './data', database: 'agent.db' }),
    cache: new InMemoryCache(),
    blobStore: new LocalBlobStore({ path: './blobs' })
});
```

**The Reality:**
- Storage has well-defined backends (SQLite, Postgres, Redis, etc.)
- Each backend has specific config needs
- Most users stick with defaults (SQLite + in-memory cache)

**Recommendation: ❌ STAY CONFIG-BASED**

Storage is well-served by config because:
- Backends are a closed set
- Config is declarative and portable (YAML works great)
- Most users don't need custom storage implementations
- Per-agent path isolation is handled by CLI

**Possible improvement:** Support custom storage adapters for edge cases
```typescript
// 99% of users
storage: {
    database: { type: 'sqlite', path: './data' }
}

// 1% of users with DynamoDB/custom backend
storage: {
    database: new DynamoDBAdapter({
        tableName: 'dexto-sessions',
        region: 'us-east-1'
    })
}
```

But again, this is edge case optimization.

---

### 4. ❌ MCP Servers (`packages/core/src/mcp/`)

**Current Reality:**
```typescript
// packages/core/src/mcp/schemas.ts
export const McpServerConfigSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('stdio'),
        command: z.string(),
        args: z.array(z.string()).default([]),
        env: z.record(z.string()).default({}),
        timeout: z.number().default(30000),
        connectionMode: z.enum(['strict', 'lenient']).default('lenient'),
    }),
    z.object({
        type: z.literal('sse'),
        url: z.string().url(),
        headers: z.record(z.string()).default({}),
        timeout: z.number().default(30000),
        connectionMode: z.enum(['strict', 'lenient']).default('lenient'),
    }),
    z.object({
        type: z.literal('http'),
        url: z.string().url(),
        headers: z.record(z.string()).default({}),
        timeout: z.number().default(30000),
        connectionMode: z.enum(['strict', 'lenient']).default('lenient'),
    }),
]);
```

**Recommendation: ❌ STAY CONFIG-BASED**

MCP is already well-designed as config:
- Transport types are a closed set (stdio, sse, http)
- Config is declarative (perfect for YAML)
- Dynamic server addition: `agent.connectMcpServer('name', config)` works great

**No benefit to instance-first here.**

---

### 5. ❌ Sessions (`packages/core/src/session/`)

**Current Reality:**
```typescript
// packages/core/src/session/schemas.ts
export const SessionConfigSchema = z.object({
    maxSessions: z.number().int().positive().default(100),
    sessionTTL: z.number().int().positive().default(3600000), // 1 hour
});
```

**Recommendation: ❌ STAY CONFIG-BASED**

Sessions is just two numbers. Config is perfect. No benefit to instances.

---

### 6. ❌ Tool Confirmation (`packages/core/src/tools/`)

**Current Reality:**
```typescript
// packages/core/src/tools/schemas.ts
export const ToolConfirmationConfigSchema = z.object({
    mode: z.enum(['event-based', 'auto-approve', 'auto-deny']).default('event-based'),
    timeout: z.number().int().positive().default(120000),
    allowedToolsStorage: z.enum(['memory', 'storage']).default('storage'),
    toolPolicies: z.object({
        alwaysAllow: z.array(z.string()).default([]),
        alwaysDeny: z.array(z.string()).default([]),
    }).optional(),
});

export const InternalToolsSchema = z.array(
    z.enum(['ask_user', 'edit_file', 'create_files'])
).default([]);
```

**Recommendation: ❌ STAY CONFIG-BASED**

Tool confirmation is pure config - enums, arrays, policies. No behavior to customize.

---

### 7. ❌ Telemetry (`packages/core/src/telemetry/`)

**Current Reality:**
```typescript
// packages/core/src/telemetry/schemas.ts
export const OtelConfigurationSchema = z.object({
    serviceName: z.string().optional(),
    enabled: z.boolean().optional(),
    tracerName: z.string().optional(),
    export: z.union([
        z.object({
            type: z.literal('otlp'),
            protocol: z.enum(['grpc', 'http']).optional(),
            endpoint: z.string().optional(),
            headers: z.record(z.string()).optional(),
        }),
        z.object({
            type: z.literal('console'),
        }),
    ]).optional(),
});
```

**Recommendation: ❌ STAY CONFIG-BASED**

Telemetry is configuration of OpenTelemetry SDK. Pure config, no custom behavior.

---

### 8. ❌ System Prompt (`packages/core/src/systemPrompt/`)

**Current Reality:**
```typescript
// packages/core/src/systemPrompt/schemas.ts
export const SystemPromptConfigSchema = z.union([
    z.string(),  // Simple string
    z.object({
        contributors: z.array(z.discriminatedUnion('type', [
            z.object({
                type: z.literal('static'),
                content: z.string(),
                priority: z.number(),
                enabled: z.boolean(),
            }),
            z.object({
                type: z.literal('dynamic'),
                source: z.enum(['dateTime', 'resources']),
                priority: z.number(),
                enabled: z.boolean(),
            }),
            z.object({
                type: z.literal('file'),
                files: z.array(z.string()),
                priority: z.number(),
                enabled: z.boolean(),
                options: z.object({...}),
            }),
            z.object({
                type: z.literal('memory'),
                priority: z.number(),
                enabled: z.boolean(),
                options: z.object({...}),
            }),
        ])),
    }),
]);
```

**Recommendation: ❌ STAY CONFIG-BASED**

System prompt is complex but declarative. Config handles static content, file references, dynamic sources. No custom behavior needed.

---

### 9. ❌ Resources (`packages/core/src/resources/`)

**Current Reality:**
```typescript
// packages/core/src/resources/schemas.ts
export const InternalResourcesSchema = z.union([
    z.array(z.discriminatedUnion('type', [
        z.object({
            type: z.literal('filesystem'),
            paths: z.array(z.string()),
            maxDepth: z.number().default(3),
            maxFiles: z.number().default(1000),
            includeHidden: z.boolean().default(false),
            includeExtensions: z.array(z.string()).default([...]),
        }),
        z.object({
            type: z.literal('blob'),
        }),
    ])),
    z.object({
        enabled: z.boolean().optional(),
        resources: z.array(...),
    }),
]);
```

**Recommendation: ❌ STAY CONFIG-BASED**

Resources configuration is declarative - paths, file filters, depth limits. Perfect as config.

---

### 10. ❌ Starter Prompts (`packages/core/src/prompts/`)

**Current Reality:**
```typescript
// packages/core/src/prompts/schemas.ts
export const StarterPromptsSchema = z.array(
    z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional().default(''),
        prompt: z.string(),
        category: z.string().optional().default('general'),
        priority: z.number().optional().default(0),
    })
).default([]);
```

**Recommendation: ❌ STAY CONFIG-BASED**

Starter prompts are pure data - strings, categories, priorities. No behavior.

---

### 11. ❌ Agent Card (`AgentCardSchema`)

**Current Reality:**
```typescript
export const AgentCardSchema = z.object({
    name: z.string(),
    description: z.string().default('...'),
    url: z.string().url(),
    provider: z.object({ organization: z.string(), url: z.string().url() }).optional(),
    version: z.string(),
    documentationUrl: z.string().url().optional(),
    capabilities: z.object({ streaming: z.boolean(), ... }).default({}),
    authentication: z.object({ schemes: z.array(z.string()), ... }).default({}),
    defaultInputModes: z.array(z.string()).default([...]),
    defaultOutputModes: z.array(z.string()).default([...]),
    skills: z.array(z.object({ id, name, description, ... })).default([...]),
});
```

**Recommendation: ❌ STAY CONFIG-BASED**

Agent card is metadata for A2A discovery. Pure data, no behavior.

---

## Modules That DON'T Exist (But I Mentioned)

### ❌ Hooks
**Reality:** Hooks don't exist as a separate system. Plugin extension points (`beforeLLMRequest`, `beforeToolCall`, etc.) serve this purpose.

### ❌ Input/Output Processors
**Reality:** These don't exist. Plugins can intercept at extension points to achieve similar effects.

### ❌ Custom Tools
**Reality:** Tools come from two sources:
1. MCP servers (config-driven)
2. Internal tools (array of enabled tool names)

There's no support for registering custom tools via code. Users would need to create an MCP server or contribute to internal tools.

---

## What Features ACTUALLY Need Instance Support?

### 1. ✅ Plugins (Already Hybrid)

**Why:** Plugins are behavior, not data. Users must write code.

**Current state:** Config points to module paths, modules export code.

**Improvement:** Support direct instance registration for library users

```typescript
// Current (YAML users)
plugins:
  custom:
    - name: analytics
      module: ./plugins/analytics.js

// Proposed (TypeScript library users)
plugins: {
    custom: [
        new MyAnalyticsPlugin()
    ]
}
```

---

## What Features COULD Benefit from Optional Instance Support?

### 1. ⚠️ LLM (For Custom Providers)

**Why:** 95% of users use OpenAI/Anthropic (config is great). 5% might need custom LLM endpoints.

**Implementation:**
```typescript
type LLMInput = LLMConfig | ILLMClient;

// 95% of users
llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' }

// 5% of users
llm: new CustomLLMClient({ endpoint: 'https://my-llm.com' })
```

**Trade-off:** Adds complexity for edge case. Is it worth it?

### 2. ⚠️ Storage (For Custom Backends)

**Why:** 95% of users use SQLite/Postgres (config is great). 5% might need DynamoDB/custom.

**Implementation:**
```typescript
type DatabaseInput = DatabaseConfig | IDatabase;

// 95% of users
storage: { database: { type: 'sqlite', path: './data' } }

// 5% of users
storage: { database: new DynamoDBAdapter({ ... }) }
```

**Trade-off:** Adds complexity for edge case. Is it worth it?

### 3. ⚠️ Logger (For Custom Transports)

**Why:** Most users use file/console. Some might want custom log destinations.

**Implementation:**
```typescript
type LoggerInput = LoggerConfig | ILogger;

// Most users
logger: { level: 'info', transports: [{ type: 'file', path: './logs/app.log' }] }

// Custom users
logger: new CustomLogger({ ... })
```

**Trade-off:** This actually makes sense if we're refactoring logger anyway.

---

## Recommendation: Surgical Approach

### Phase 1: Improve Plugin System (High Value, Low Cost)

**Current state:** Plugins work via module paths

**Improvement:** Support instance registration for library users

```typescript
// Type definition
type PluginInput = PluginConfig | DextoPlugin;

// Config in YAML (unchanged)
plugins:
  custom:
    - name: analytics
      module: ./plugins/analytics.js
      config: { apiKey: $ANALYTICS_KEY }

// Instance in TypeScript (new)
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    plugins: {
        custom: [
            new AnalyticsPlugin({ apiKey: process.env.ANALYTICS_KEY }),
            new RateLimitPlugin({ maxRequests: 100 })
        ]
    }
});
```

**Why this is valuable:**
- Plugins ARE code (they implement interfaces)
- TypeScript users get better autocomplete
- No migration needed (config still works)
- Natural fit for the abstraction

**Implementation:**
```typescript
class DextoAgent {
    constructor(options: AgentConfig) {
        // Normalize plugin input
        if (options.plugins?.custom) {
            options.plugins.custom = options.plugins.custom.map(p => {
                if (this.isPluginInstance(p)) {
                    // Wrap instance in config format
                    return {
                        name: p.constructor.name,
                        plugin: p,  // Store instance directly
                        enabled: true,
                        blocking: false,
                        priority: 0,
                    };
                }
                return p;  // Already config
            });
        }
    }

    private isPluginInstance(input: any): input is DextoPlugin {
        return typeof input.beforeLLMRequest === 'function' ||
               typeof input.beforeToolCall === 'function' ||
               typeof input.afterToolResult === 'function' ||
               typeof input.beforeResponse === 'function';
    }
}
```

---

### Phase 2: Optional - Logger Instance Support (If Refactoring Logger)

If we're already refactoring logger (per logger-architecture-recommendations.md), add instance support:

```typescript
type LoggerInput = LoggerConfig | ILogger;

const agent = new DextoAgent({
    logger: new DextoLogger({
        level: 'debug',
        transports: [
            new FileTransport({ path: './logs/app.log' }),
            new CustomTransport()
        ]
    })
});
```

**Why:** Logger needs refactoring anyway, and custom transports are reasonable.

---

### Phase 3: Maybe - Custom LLM/Storage (Only If Actual Demand)

Don't implement until users actually ask for it. Most users are fine with standard providers/storage.

If needed:
```typescript
// Custom LLM
type LLMInput = LLMConfig | ILLMClient;

// Custom storage
type StorageInput = StorageConfig | { database: IDatabase, cache: ICache, blob: IBlobStore };
```

But wait for real-world demand first.

---

## Final Verdict

| Module | Current | Recommendation | Reasoning |
|--------|---------|----------------|-----------|
| **Plugins** | Config → Module | ✅ Add instance support | Already code-based, natural fit |
| **Logger** | N/A (singleton) | ⚠️ Optional instance support | If refactoring anyway, add it |
| **LLM** | Config | ❌ Stay config | Extensive validation, dynamic switching, closed set |
| **Storage** | Config | ❌ Stay config | Closed set, most users happy with defaults |
| **MCP** | Config | ❌ Stay config | Transport types are closed set, config works great |
| **Sessions** | Config | ❌ Stay config | Just two numbers |
| **Telemetry** | Config | ❌ Stay config | OTEL config, no custom behavior |
| **Tool Confirmation** | Config | ❌ Stay config | Policies and enums |
| **System Prompt** | Config | ❌ Stay config | Declarative, no behavior |
| **Resources** | Config | ❌ Stay config | Paths and filters |
| **Starter Prompts** | Config | ❌ Stay config | Pure data |
| **Agent Card** | Config | ❌ Stay config | Metadata |

---

## What I Got Wrong in My Previous Analysis

1. **Hooks don't exist** - Plugins serve this purpose
2. **Input/Output processors don't exist** - Plugins serve this purpose
3. **Custom tools beyond MCP don't exist** - No API for this
4. **Most modules are simple config** - Not complex services that need DI

---

## Why Config-First is Actually Better for Dexto

### 1. **YAML Support is First-Class**

Dexto is designed for config-driven deployments. Most configuration is declarative:
- Provider names (not provider implementations)
- File paths (not file handlers)
- Numbers and booleans (not behaviors)

Config shines here.

### 2. **CLI Users Outnumber Library Users**

Current user base primarily uses CLI with YAML files. Breaking this for library users' convenience would be bad prioritization.

### 3. **Validation is Critical**

Extensive Zod validation catches misconfigurations early:
- Invalid provider/model combinations
- Missing API keys
- Incompatible baseURL usage
- Cross-field validation

Losing this for instance-first would be a regression.

### 4. **Portability**

YAML configs can be:
- Checked into version control
- Shared across teams
- Deployed to different environments
- Modified without code changes

This is valuable.

---

## Surgical Recommendation

**Implement ONLY Phase 1:** Plugin instance support

**Why:**
- ✅ High value (plugins ARE code)
- ✅ Low cost (small change to normalization)
- ✅ No breaking changes
- ✅ Natural fit for abstraction

**Don't implement:**
- ❌ Full instance-first refactor
- ❌ Custom LLM instances (yet)
- ❌ Custom storage instances (yet)
- ❌ Anything else

**Wait for:**
- Real user demand for custom LLM providers
- Real user demand for custom storage backends
- Evidence that config is actually limiting users

---

## What This Means for Library Users

**Current library usage:**
```typescript
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful'
});
```

**After Phase 1:**
```typescript
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful',
    plugins: {
        custom: [
            new MyAnalyticsPlugin(),  // ← NEW: instance support
            new MyLoggingPlugin()
        ]
    }
});
```

**Why this is enough:**
- Library users still use config for LLM, storage, etc. (which is fine!)
- Library users can inject plugin instances (which is better!)
- No breaking changes
- Clean, focused improvement

---

## Conclusion

After deeply analyzing Dexto's actual codebase:

1. **Most modules are well-served by config** (LLM, storage, MCP, sessions, telemetry, etc.)
2. **ONE module truly benefits from instances** (plugins)
3. **A few modules could optionally support instances** (logger, maybe LLM/storage for edge cases)

**My recommendation: Add plugin instance support only. Stop there unless users demand more.**

This gives library users flexibility where it matters (custom behavior via plugins) while preserving the config-driven architecture that serves CLI users and most library users well.

Don't solve problems users don't have. Wait for real demand before adding complexity.
