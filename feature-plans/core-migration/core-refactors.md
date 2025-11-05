# Core Refactors: Config vs Instances Architecture

**Status:** Architectural Guidelines
**Owner:** @me
**Purpose:** Document the architectural decision to maintain config-first design for most of Dexto's core, with selective instance support for plugins only.

---

## Executive Summary

After systematic analysis of every module in Dexto's core (see `research/instance-vs-config-grounded-analysis.md` for full details), we concluded that **config-first architecture serves Dexto well**. Only ONE module truly benefits from instance support: **Plugins**.

---

## The Config-First Architecture

Dexto's core is built around declarative configuration. The `AgentConfigSchema` includes:

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

## Module Classification

After analyzing each module, here's what we found:

### ✅ Plugins - Instance Support Needed

**Current Reality:**
```typescript
// Current: Config points to module paths
export const CustomPluginConfigSchema = z.object({
    name: z.string(),
    module: z.string(),  // ← Points to code file
    enabled: z.boolean().default(true),
    blocking: z.boolean(),
    priority: z.number().int(),
    config: z.record(z.any()).optional(),
});
```

**Why Instances Make Sense:**
- Plugins ARE code (implement `DextoPlugin` interface with lifecycle methods)
- Users must write TypeScript/JavaScript to create custom behavior
- Config currently just points to module files anyway
- TypeScript users would benefit from direct instance registration

**Recommended Enhancement:**
```typescript
// Support both config and instances
type PluginInput = PluginConfig | DextoPlugin;

// Library users can pass instances directly
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    plugins: {
        custom: [
            new AnalyticsPlugin({ apiKey: process.env.ANALYTICS_KEY }),
            new RateLimitPlugin({ maxRequests: 100 })
        ]
    }
});

// YAML users still use module paths
plugins:
  custom:
    - name: analytics
      module: ./plugins/analytics.js
      config: { apiKey: $ANALYTICS_KEY }
```

### ❌ Everything Else - Stay Config-Based

**Why Config Works Well:**

1. **LLM (`@dexto/core/llm/`)**
   - Closed set of providers (OpenAI, Anthropic, Google, Groq)
   - Extensive validation logic (model compatibility, API keys, baseURL support)
   - Dynamic switching via `switchLLM()` expects config
   - 95%+ of users use standard providers

2. **Storage (`@dexto/core/storage/`)**
   - Closed set of backends (SQLite, Postgres, Redis, in-memory)
   - Discriminated unions work perfectly for type safety
   - Most users stick with defaults (SQLite + in-memory cache)
   - Config is portable across environments

3. **MCP Servers (`@dexto/core/mcp/`)**
   - Transport types are finite (stdio, SSE, HTTP)
   - Config is declarative and YAML-friendly
   - Dynamic server addition already works: `agent.connectMcpServer('name', config)`

4. **Sessions, Telemetry, Tool Confirmation**
   - Pure configuration (enums, numbers, policies)
   - No custom behavior to implement
   - Validation is straightforward

5. **System Prompt, Resources, Starter Prompts, Agent Card**
   - Pure data (strings, paths, metadata)
   - Declarative by nature
   - No benefit from instance support

---

## Why Config-First is Right for Dexto

### 1. YAML Support is First-Class

Dexto is designed for config-driven deployments:
```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

storage:
  database:
    type: sqlite
    path: ./data

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"]
```

This is **portable, version-controllable, and environment-independent**.

### 2. CLI Users Outnumber Library Users

Current user base primarily uses CLI with YAML files. Breaking this for library convenience would be bad prioritization.

### 3. Validation is Critical

Extensive Zod validation catches misconfigurations early:
- Invalid provider/model combinations
- Missing API keys
- Incompatible baseURL usage
- Cross-field validation with `superRefine`

Losing this for instance-first would be a regression.

### 4. Dynamic Switching

Features like `switchLLM()` rely on config-based inputs:
```typescript
// Runtime model switching
await agent.switchLLM({
    provider: 'anthropic',
    model: 'claude-3-opus'
});
```

This wouldn't work well with pre-instantiated LLM clients.

---

## Recommendation: Surgical Approach

**Phase 1: Plugin Instance Support (High Value, Low Cost)**

Implement instance support for plugins only:

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

**Why This is Valuable:**
- ✅ Plugins ARE code (natural fit for instances)
- ✅ TypeScript users get better autocomplete
- ✅ No migration needed (config still works)
- ✅ No breaking changes

**Don't Implement Yet:**
- ❌ Custom LLM instances (wait for demand)
- ❌ Custom storage instances (wait for demand)
- ❌ Full instance-first refactor

---

## Optional Future Enhancements

### Custom LLM/Storage (Only If Actual Demand)

If 5% of users need custom LLM endpoints or storage backends:

```typescript
type LLMInput = LLMConfig | ILLMClient;
type DatabaseInput = DatabaseConfig | IDatabase;

// 95% of users (config)
llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' }

// 5% of users (instance)
llm: new CustomLLMClient({ endpoint: 'https://my-llm.com' })
```

**Wait for real-world demand before implementing.** Don't solve problems users don't have.

---

## Final Architecture Matrix

| Module | Current | Recommendation | Reasoning |
|--------|---------|----------------|-----------|
| **Plugins** | Config → Module | ✅ Add instance support | Code-based, natural fit |
| **LLM** | Config | ❌ Stay config | Closed set, validation critical |
| **Storage** | Config | ❌ Stay config | Closed set, defaults work well |
| **MCP** | Config | ❌ Stay config | Transports are finite |
| **Sessions** | Config | ❌ Stay config | Just two numbers |
| **Telemetry** | Config | ❌ Stay config | OTEL config only |
| **Tool Confirmation** | Config | ❌ Stay config | Policies and enums |
| **System Prompt** | Config | ❌ Stay config | Declarative content |
| **Resources** | Config | ❌ Stay config | Paths and filters |
| **Starter Prompts** | Config | ❌ Stay config | Pure data |
| **Agent Card** | Config | ❌ Stay config | Metadata only |

---

## What This Means for Users

**Current library usage (stays mostly the same):**
```typescript
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful'
});
```

**After enhancement (plugin instances supported):**
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
- Library users still use config for LLM, storage, etc. (which works great!)
- Library users can inject plugin instances (which is better for code!)
- No breaking changes
- Clean, focused improvement

---

## Conclusion

After deeply analyzing Dexto's actual codebase:

1. **Most modules are well-served by config** (LLM, storage, MCP, sessions, telemetry, etc.)
2. **ONE module truly benefits from instances** (plugins)
3. **Future optional support** could be added for LLM/storage if demand materializes

**Recommendation: Add plugin instance support only. Stop there unless users demand more.**

This gives library users flexibility where it matters (custom behavior via plugins) while preserving the config-driven architecture that serves CLI users and most library users well.

---

## Related Documents

- **Full Analysis**: See `research/instance-vs-config-grounded-analysis.md` for complete module-by-module analysis
- **Logger Refactor**: See `logger-architecture-recommendations.md` for logger-specific improvements
- **Research Context**: See `research/README.md` for all architectural trade-off discussions
