# Code-First API Design for DextoAgent

## Executive Summary

**YES, this is not only feasible but highly recommended.** Making DextoAgent constructor accept both config objects (YAML-derived) and service instances (code-based) provides the best of both worlds: CLI users keep their declarative YAML approach, while library users get a flexible, type-safe code-first API.

**Key Insight**: Config-first and code-first are **not mutually exclusive**. The CLI handles config→instances conversion, while core provides a flexible API that accepts both.

---

## Current Architecture Analysis

### How It Works Today

**1. Constructor accepts config:**
```typescript
// packages/core/src/agent/DextoAgent.ts:167-176
constructor(
    config: AgentConfig,
    private configPath?: string
) {
    // Validate and transform the input config
    this.config = AgentConfigSchema.parse(config);
    logger.info('DextoAgent created.');
}
```

**2. start() creates services from config:**
```typescript
// packages/core/src/agent/DextoAgent.ts:185-195
public async start(): Promise<void> {
    // Initialize all services asynchronously
    const services = await createAgentServices(this.config, this.configPath);

    // Assign services to readonly properties
    Object.assign(this, {
        mcpManager: services.mcpManager,
        toolManager: services.toolManager,
        // ... etc
    });
}
```

**3. createAgentServices wires everything:**
```typescript
// packages/core/src/utils/service-initializer.ts:71-98
export async function createAgentServices(
    config: ValidatedAgentConfig,
    configPath?: string,
    agentId?: string
): Promise<AgentServices> {
    // Create all services from config
    const agentEventBus = new AgentEventBus();
    const storageManager = await createStorageManager(config.storage, effectiveAgentId);
    const mcpManager = new MCPManager(config.mcpServers, ...);
    // ... etc

    return {
        mcpManager,
        toolManager,
        storageManager,
        // ... etc
    };
}
```

### Current Usage Pattern

**CLI (YAML-driven):**
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
```

```typescript
// CLI loads YAML and creates agent
const config = await loadConfigFile('agents/my-agent.yml');
const agent = new DextoAgent(config, 'agents/my-agent.yml');
await agent.start();
```

**Library (also config-driven):**
```typescript
// Library users also pass config objects
const agent = new DextoAgent({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: process.env.OPENAI_API_KEY
    },
    storage: {
        database: { type: 'sqlite', path: './data' }
    }
});
await agent.start();
```

**Problem**: Library users have to work with config objects even when they want to use custom instances.

---

## Proposed Architecture: Hybrid Config + Code-First

### Three Usage Styles

#### Style 1: Full Config (Current - Preserved)

```typescript
const agent = new DextoAgent({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: process.env.OPENAI_API_KEY
    },
    storage: {
        database: { type: 'sqlite', path: './data' },
        blob: { type: 'local', storePath: './blobs' }
    },
    logger: {
        level: 'debug',
        transports: [
            { type: 'file', path: './logs/agent.log' },
            { type: 'console', colorize: true }
        ]
    },
    systemPrompt: 'You are a helpful assistant'
});

await agent.start();  // Creates services from config
```

**Use case**: CLI, simple library usage, declarative configuration

#### Style 2: Hybrid (Config + Instances)

```typescript
import { DextoLogger, FileTransport, ConsoleTransport } from '@dexto/core/logger';

const logger = new DextoLogger({
    level: 'debug',
    agentId: 'my-agent',
    component: DextoLogComponent.AGENT,
    transports: [
        new FileTransport({ path: './logs/agent.log', maxSize: 10485760 }),
        new ConsoleTransport({ colorize: true })
    ]
});

const agent = new DextoAgent({
    llm: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: process.env.OPENAI_API_KEY
    },
    logger,  // ← Instance passed directly
    storage: {
        database: { type: 'sqlite', path: './data' }
    },
    systemPrompt: 'You are a helpful assistant'
});

await agent.start();  // Uses provided logger, creates other services
```

**Use case**: Custom logger but default storage, mixing approaches

#### Style 3: Full Service Injection (Advanced)

```typescript
import {
    MCPManager,
    ToolManager,
    StorageManager,
    SessionManager,
    DextoLogger
} from '@dexto/core';

// Create services explicitly
const storageManager = await StorageManager.create({
    database: { type: 'postgres', connectionString: '...' },
    cache: { type: 'redis', url: '...' }
});

const logger = new DextoLogger({ /* ... */ });
const mcpManager = new MCPManager({ /* ... */ }, logger);
const toolManager = new ToolManager(mcpManager);
const sessionManager = new SessionManager(storageManager);

// Inject all services
const agent = new DextoAgent({
    systemPrompt: 'You are a helpful assistant',
    services: {
        storageManager,
        logger,
        mcpManager,
        toolManager,
        sessionManager,
        // ... other services
    }
});

await agent.start();  // Skips service creation, uses provided services
```

**Use case**: Full control, custom implementations, advanced testing with mocks

---

## Implementation Design

### Option A: Optional Services Parameter (Recommended)

**Pros:**
- Minimal API surface change
- Backward compatible
- Clean separation of concerns
- Easy to understand

**Implementation:**
```typescript
// packages/core/src/agent/DextoAgent.ts

export type DextoAgentOptions = {
    // Config-based inputs (current)
    llm?: LLMConfig;
    storage?: StorageConfig;
    logger?: LoggerConfig;
    systemPrompt?: string | SystemPromptConfig;
    mcpServers?: McpServersConfig;
    sessions?: SessionConfig;
    toolConfirmation?: ToolConfirmationConfig;
    telemetry?: TelemetryConfig;

    // Service injection (new)
    services?: Partial<AgentServices>;
};

export class DextoAgent {
    private providedServices?: Partial<AgentServices>;

    constructor(
        options: AgentConfig | DextoAgentOptions,
        configPath?: string
    ) {
        // Detect if it's new format with services
        if ('services' in options && options.services) {
            this.providedServices = options.services;
            // Still validate config parts
            this.config = this.extractConfigFromOptions(options);
        } else {
            // Original path: full config validation
            this.config = AgentConfigSchema.parse(options);
        }

        this.configPath = configPath;
        logger.info('DextoAgent created.');
    }

    public async start(): Promise<void> {
        if (this._isStarted) {
            throw AgentError.alreadyStarted();
        }

        try {
            logger.info('Starting DextoAgent...');

            // Create services, merging provided ones
            const createdServices = this.providedServices
                ? await this.createMissingServices(this.config, this.providedServices)
                : await createAgentServices(this.config, this.configPath);

            // Merge provided and created services
            const services = {
                ...createdServices,
                ...this.providedServices
            };

            // Validate all required services exist
            for (const service of requiredServices) {
                if (!services[service]) {
                    throw AgentError.initializationFailed(
                        `Required service ${service} is missing`
                    );
                }
            }

            // Assign services to readonly properties
            Object.assign(this, { ...services, services });

            this._isStarted = true;
            logger.info('DextoAgent started successfully.');
        } catch (error) {
            throw AgentError.initializationFailed(
                `Failed to start agent: ${error.message}`
            );
        }
    }

    private async createMissingServices(
        config: ValidatedAgentConfig,
        providedServices: Partial<AgentServices>
    ): Promise<AgentServices> {
        // Create only services that weren't provided
        const agentEventBus = providedServices.agentEventBus || new AgentEventBus();

        const storageManager = providedServices.storageManager
            || await createStorageManager(config.storage, this.getAgentId());

        const mcpManager = providedServices.mcpManager
            || new MCPManager(config.mcpServers, /* ... */);

        // ... create other missing services

        return {
            agentEventBus,
            storageManager,
            mcpManager,
            // ... rest of services
        } as AgentServices;
    }

    private extractConfigFromOptions(options: DextoAgentOptions): ValidatedAgentConfig {
        // Convert options to config format for validation
        const config: Partial<AgentConfig> = {
            llm: options.llm,
            storage: options.storage,
            logger: options.logger,
            systemPrompt: options.systemPrompt,
            mcpServers: options.mcpServers,
            sessions: options.sessions,
            toolConfirmation: options.toolConfirmation,
            telemetry: options.telemetry
        };

        return AgentConfigSchema.parse(config);
    }
}
```

### Option B: Union Type with Type Guards

**Pros:**
- More explicit type safety
- Clear distinction between config and code-first

**Cons:**
- More complex type signatures
- Harder to mix approaches

**Implementation:**
```typescript
type ConfigInput = {
    type: 'config';
    config: AgentConfig;
    configPath?: string;
};

type ServicesInput = {
    type: 'services';
    services: AgentServices;
    config?: Partial<AgentConfig>;
};

export class DextoAgent {
    constructor(input: ConfigInput | ServicesInput) {
        if (input.type === 'config') {
            this.config = AgentConfigSchema.parse(input.config);
            this.configPath = input.configPath;
        } else {
            this.providedServices = input.services;
            this.config = this.createMinimalConfig(input.config);
        }
    }
}

// Usage
const agent = new DextoAgent({
    type: 'services',
    services: { mcpManager, toolManager, /* ... */ },
    config: { systemPrompt: '...' }
});
```

**Verdict**: Option B is more verbose for users. **Option A is better**.

### Option C: Factory Methods

**Pros:**
- Clearest separation
- No overloading complexity

**Cons:**
- Breaking change (requires `.fromConfig()`)
- More API surface to document

**Implementation:**
```typescript
export class DextoAgent {
    private constructor(/* internal only */) {}

    // Config-based factory
    static async fromConfig(
        config: AgentConfig,
        configPath?: string
    ): Promise<DextoAgent> {
        const agent = new DextoAgent();
        agent.config = AgentConfigSchema.parse(config);
        agent.configPath = configPath;
        await agent.start();
        return agent;
    }

    // Service-based factory
    static fromServices(
        services: AgentServices,
        config?: Partial<AgentConfig>
    ): DextoAgent {
        const agent = new DextoAgent();
        agent.providedServices = services;
        agent.config = this.createMinimalConfig(config);
        return agent;
    }
}

// Usage
const agent = await DextoAgent.fromConfig(config);
const agent2 = DextoAgent.fromServices(services);
```

**Verdict**: Clean but breaks existing API. Could be considered for v2.0.

---

## Recommended Approach: Option A + Phases

### Phase 1: Service Injection Foundation (4-6 hours)

**Goal**: Allow optional service injection without breaking existing API.

**Changes:**
1. Add optional `services` parameter to constructor
2. Modify `start()` to use provided services
3. Create `createMissingServices()` helper

**Example:**
```typescript
// New capability - inject logger
const logger = new DextoLogger({ /* ... */ });

const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful',
    services: { logger }  // ← Inject specific service
});

await agent.start();  // Uses provided logger, creates other services
```

**Testing:**
```typescript
// Easy mocking for tests
const mockMcpManager = createMockMCPManager();
const mockToolManager = createMockToolManager();

const agent = new DextoAgent({
    llm: { /* ... */ },
    services: {
        mcpManager: mockMcpManager,
        toolManager: mockToolManager
    }
});

await agent.start();
// Agent uses mocks, can test in isolation
```

### Phase 2: Extract Service Factories (8-10 hours)

**Goal**: Make service creation logic reusable for library users.

**Create public factory functions:**
```typescript
// packages/core/src/services/factories/logger.ts
export function createLogger(
    config: LoggerConfig,
    agentId: string
): IDextoLogger {
    const transports = config.transports.map(tc => {
        switch (tc.type) {
            case 'file': return new FileTransport(tc);
            case 'console': return new ConsoleTransport(tc);
            case 'upstash': return new UpstashTransport(tc);
        }
    });

    return new DextoLogger({
        level: config.level,
        component: DextoLogComponent.AGENT,
        agentId,
        transports
    });
}

// packages/core/src/services/factories/storage.ts
export async function createStorageManager(
    config: StorageConfig,
    agentId: string
): Promise<StorageManager> {
    // Existing logic from service-initializer
    // Just make it public
}

// packages/core/src/services/factories/mcp.ts
export async function createMCPManager(
    config: McpServersConfig,
    logger: IDextoLogger
): Promise<MCPManager> {
    return new MCPManager(config, logger);
}

// packages/core/src/services/factories/index.ts
export {
    createLogger,
    createStorageManager,
    createMCPManager,
    createToolManager,
    createSessionManager,
    // ... all factories
};
```

**Library users can now:**
```typescript
import {
    createLogger,
    createStorageManager,
    DextoAgent
} from '@dexto/core';

// Create services with factories
const logger = createLogger({
    level: 'debug',
    transports: [
        { type: 'file', path: './logs/agent.log' },
        { type: 'console', colorize: true }
    ]
}, 'my-agent');

const storage = await createStorageManager({
    database: { type: 'sqlite', path: './data' },
    blob: { type: 'local', storePath: './blobs' }
}, 'my-agent');

// Inject via services
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    systemPrompt: 'You are helpful',
    services: { logger, storageManager: storage }
});

await agent.start();
```

### Phase 3: Instance OR Config Union Types (12-16 hours)

**Goal**: Accept either config objects OR instances for maximum flexibility.

**Add union types:**
```typescript
// packages/core/src/agent/types.ts

export type LLMInput =
    | LLMConfig
    | LLMClientInstance;  // Actual LLM client

export type StorageInput =
    | StorageConfig
    | StorageManager;

export type LoggerInput =
    | LoggerConfig
    | IDextoLogger;

export type DextoAgentInput = {
    llm: LLMInput;
    storage?: StorageInput;
    logger?: LoggerInput;
    systemPrompt?: string | SystemPromptConfig;
    mcpServers?: McpServersConfig | Record<string, MCPServerInstance>;
    services?: Partial<AgentServices>;
};
```

**Update constructor:**
```typescript
export class DextoAgent {
    constructor(
        input: AgentConfig | DextoAgentInput,
        configPath?: string
    ) {
        if (isAgentConfig(input)) {
            // Original path: full config
            this.config = AgentConfigSchema.parse(input);
            this.configPath = configPath;
        } else {
            // New path: normalize inputs
            this.normalizedInput = this.normalizeInput(input);
            this.config = this.extractConfigFromInput(input);
        }
    }

    private normalizeInput(input: DextoAgentInput): NormalizedInput {
        return {
            llm: isLLMInstance(input.llm) ? input.llm : null,
            llmConfig: isLLMInstance(input.llm) ? null : input.llm,

            storage: isStorageManager(input.storage) ? input.storage : null,
            storageConfig: isStorageManager(input.storage) ? null : input.storage,

            logger: isLogger(input.logger) ? input.logger : null,
            loggerConfig: isLogger(input.logger) ? null : input.logger,

            services: input.services,
            systemPrompt: input.systemPrompt
        };
    }
}
```

**Library users now have maximum flexibility:**
```typescript
import { DextoLogger, FileTransport } from '@dexto/core/logger';
import { SQLiteStorage } from '@dexto/core/storage';
import { OpenAIClient } from '@dexto/llm';

// Mix instances and configs
const agent = new DextoAgent({
    llm: new OpenAIClient({  // ← Instance
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-5-mini'
    }),
    storage: {  // ← Config
        database: { type: 'sqlite', path: './data' }
    },
    logger: new DextoLogger({  // ← Instance
        level: 'debug',
        transports: [new FileTransport({ path: './logs/app.log' })]
    })
});

await agent.start();
```

### Phase 4: CLI Enrichment Layer (4-6 hours)

**Goal**: CLI converts YAML to enriched config, then to instances internally.

**CLI stays config-first externally:**
```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY

logger:
  level: debug
  transports:
    - type: file
      path: ~/.dexto/logs/my-agent/dexto.log
    - type: console
      colorize: true

storage:
  database:
    type: sqlite
    path: ~/.dexto/database
```

**CLI internally uses factories:**
```typescript
// packages/cli/src/config/enrichment.ts

export async function createAgentFromConfig(
    configPath: string
): Promise<DextoAgent> {
    // 1. Load YAML
    const rawConfig = await loadConfigFile(configPath);

    // 2. Derive agent ID
    const agentId = deriveDisplayName(
        rawConfig.agentCard?.name ||
        path.basename(configPath, path.extname(configPath))
    );

    // 3. Enrich config with defaults
    const enrichedConfig = enrichAgentConfig(agentId, rawConfig);

    // 4. Create services from enriched config
    const logger = createLogger(enrichedConfig.logger!, agentId);
    const storage = await createStorageManager(enrichedConfig.storage, agentId);

    // 5. Create agent with instances
    const agent = new DextoAgent({
        ...enrichedConfig,
        services: {
            logger,
            storageManager: storage
        }
    });

    await agent.start();
    return agent;
}
```

**Benefit**: CLI has full control over instance creation, can add CLI-specific logic (path enrichment, environment detection, etc.) without core knowing about it.

---

## Comparison: Dexto vs Mastra

### Mastra's Approach

```typescript
// Mastra is purely code-first
import { Agent } from '@mastra/core';
import { anthropic } from '@ai-sdk/anthropic';
import { PostgresMemory } from '@mastra/memory';

const agent = new Agent({
    name: 'Bird checker',
    instructions: 'You can view an image and figure out if it is a bird...',
    model: anthropic('claude-3-haiku-20240307'),  // ← Instance from Vercel AI SDK
    memory: new PostgresMemory({  // ← Instance
        connectionString: process.env.DATABASE_URL
    })
});

// No YAML, no config files, purely TypeScript
```

**Characteristics:**
- Library-first (no CLI)
- TypeScript-only (no YAML support)
- Dependency injection via constructor
- Works with Vercel AI SDK instances

### Dexto's Hybrid Approach (Proposed)

```typescript
// Style 1: Config-first (CLI, simple library usage)
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } }
});

// Style 2: Code-first (advanced library usage)
import { OpenAIClient } from '@dexto/llm';
import { SQLiteStorage } from '@dexto/storage';

const agent = new DextoAgent({
    llm: new OpenAIClient({ apiKey: '...', model: 'gpt-5-mini' }),
    storage: new SQLiteStorage({ path: './data', database: 'agent.db' })
});

// Style 3: YAML (CLI users)
// agents/my-agent.yml
// dexto run agents/my-agent.yml
```

**Characteristics:**
- Both library and CLI
- Both TypeScript and YAML
- Dependency injection optional
- Config-first with code-first escape hatch

**Advantage**: Serves both audiences without compromising either.

---

## Migration Path for Existing Users

### Zero Breaking Changes

**Existing code continues to work:**
```typescript
// v1.x code (still works in v2.x)
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful'
});

await agent.start();
```

**New capabilities are opt-in:**
```typescript
// v2.x new capability (optional)
const logger = new DextoLogger({ /* ... */ });

const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } },
    systemPrompt: 'You are helpful',
    services: { logger }  // ← New option
});

await agent.start();
```

### CLI Users: No Changes

```bash
# Works exactly the same
dexto run agents/my-agent.yml
```

YAML files unchanged, CLI internally uses new factories.

### Library Users: Gradual Adoption

**Week 1: Try service factories**
```typescript
import { createLogger } from '@dexto/core';

const logger = createLogger({
    level: 'debug',
    transports: [/* ... */]
}, 'my-agent');

const agent = new DextoAgent({
    llm: { /* ... */ },
    services: { logger }
});
```

**Week 2: Try instance injection**
```typescript
import { DextoLogger, FileTransport } from '@dexto/core/logger';

const logger = new DextoLogger({
    level: 'debug',
    transports: [new FileTransport({ path: './logs/app.log' })]
});

const agent = new DextoAgent({
    llm: { /* ... */ },
    logger  // ← Pass instance directly
});
```

**Week 3: Full code-first**
```typescript
import { OpenAIClient } from '@dexto/llm';
import { SQLiteStorage } from '@dexto/storage';
import { DextoLogger } from '@dexto/logger';

const agent = new DextoAgent({
    llm: new OpenAIClient({ /* ... */ }),
    storage: new SQLiteStorage({ /* ... */ }),
    logger: new DextoLogger({ /* ... */ })
});
```

---

## Benefits Analysis

### For CLI Users

**No Changes Required:**
- YAML files work exactly the same
- No migration needed
- Existing workflows preserved

**Behind the Scenes:**
- CLI uses factories internally for better maintainability
- Easier to add CLI-specific logic (path enrichment, env detection)
- Better separation of concerns

### For Library Users

**Before (Config-Only):**
```typescript
// Hard to customize implementations
const agent = new DextoAgent({
    llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: '...' },
    storage: { database: { type: 'sqlite', path: './data' } }
});

// Can't use custom logger, must use default
// Can't integrate with existing storage layer
// Hard to test with mocks
```

**After (Hybrid):**
```typescript
// Easy to customize
const agent = new DextoAgent({
    llm: new CustomLLMClient({ /* ... */ }),  // Custom implementation
    storage: existingStorageLayer,  // Reuse existing storage
    logger: applicationLogger  // Use app's logger
});

// Easy to test
const agent = new DextoAgent({
    llm: mockLLM,
    storage: mockStorage,
    logger: mockLogger
});
```

### For Framework Maintainers

**Better Architecture:**
- Clear separation: CLI handles config, core handles runtime
- Service factories are reusable building blocks
- Easier to extend with new service types
- More testable (inject mocks easily)

**Industry Alignment:**
- Matches Mastra, Vercel AI SDK, LangChain patterns
- Familiar to TypeScript developers
- Easier onboarding for library users

**Future-Proof:**
- As Dexto grows as a library, this pattern scales well
- Plugin system can provide custom implementations
- Users can swap out any component

---

## Implementation Timeline

### Phase 1: Service Injection Foundation
**Duration**: 4-6 hours

**Deliverables:**
- [ ] Add optional `services` parameter to DextoAgent constructor
- [ ] Modify `start()` to merge provided and created services
- [ ] Create `createMissingServices()` helper
- [ ] Add type guards for service detection
- [ ] Unit tests for service injection

### Phase 2: Extract Service Factories
**Duration**: 8-10 hours

**Deliverables:**
- [ ] Extract `createLogger()` factory
- [ ] Extract `createStorageManager()` factory (already exists, make public)
- [ ] Extract `createMCPManager()` factory
- [ ] Extract other service factories
- [ ] Create `packages/core/src/services/factories/index.ts`
- [ ] Update exports in `packages/core/src/index.ts`
- [ ] Documentation for factory functions
- [ ] Unit tests for each factory

### Phase 3: Instance OR Config Union Types
**Duration**: 12-16 hours

**Deliverables:**
- [ ] Define `DextoAgentInput` type with union types
- [ ] Add type guards (isLLMInstance, isStorageManager, etc.)
- [ ] Update constructor to handle both config and instances
- [ ] Create `normalizeInput()` helper
- [ ] Update `createMissingServices()` to handle normalized input
- [ ] Validation for instance inputs
- [ ] Unit tests for all input combinations
- [ ] Integration tests for mixed config/instance usage

### Phase 4: CLI Enrichment Layer
**Duration**: 4-6 hours

**Deliverables:**
- [ ] Update `enrichAgentConfig()` to use factories
- [ ] Create `createAgentFromConfig()` that returns instance-based agent
- [ ] Update CLI agent loading to use new approach
- [ ] Ensure per-agent path isolation works correctly
- [ ] Integration tests for CLI → agent creation

### Phase 5: Documentation & Examples
**Duration**: 8-10 hours

**Deliverables:**
- [ ] Update SDK documentation with code-first examples
- [ ] Create "Library Usage" guide
- [ ] Create "Testing with Mocks" guide
- [ ] Update CLI documentation (no changes needed for users)
- [ ] Add TypeScript examples for all three styles
- [ ] Update README with library usage patterns
- [ ] Add comparison with Mastra to docs

### Phase 6: Testing & Validation
**Duration**: 6-8 hours

**Deliverables:**
- [ ] Full config-first test suite (existing, ensure still works)
- [ ] Full code-first test suite (new)
- [ ] Hybrid config+instance test suite (new)
- [ ] CLI integration tests
- [ ] Library integration tests
- [ ] Performance benchmarks (ensure no regression)
- [ ] Memory leak tests

**Total Duration**: 42-56 hours (~1.5-2 weeks)

---

## Open Questions & Decisions Needed

### 1. Should we support LLM instance injection?

**Question**: Should users be able to pass LLM client instances directly?

```typescript
import { OpenAIClient } from '@dexto/llm';

const llmClient = new OpenAIClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-5-mini'
});

const agent = new DextoAgent({
    llm: llmClient,  // ← Instance instead of config
    // ...
});
```

**Considerations:**
- **Pro**: Maximum flexibility, users can use custom LLM clients
- **Pro**: Easier integration with Vercel AI SDK
- **Con**: LLM switching becomes more complex (config has provider/model info)
- **Con**: Need to extract provider/model from instance for validation

**Recommendation**: YES, but make it optional. Config-based LLM creation is still the default. For instance-based LLM, users lose some dynamic switching features.

### 2. Do we expose service constructors publicly?

**Question**: Should service constructors be part of public API?

```typescript
import { MCPManager, ToolManager } from '@dexto/core';

// Should users be able to do this?
const mcpManager = new MCPManager(config, logger);
const toolManager = new ToolManager(mcpManager);
```

**Considerations:**
- **Pro**: Maximum flexibility
- **Pro**: Easier for advanced users
- **Con**: More API surface to maintain
- **Con**: Constructor signatures might change
- **Con**: Users might create services incorrectly

**Recommendation**: YES, but document factories as the preferred approach. Constructors are "advanced usage" with stability warnings.

### 3. Should CLI use factories or continue with createAgentServices?

**Question**: Should CLI refactor to use factories, or keep using `createAgentServices()`?

**Option A**: CLI uses factories
```typescript
const logger = createLogger(enrichedConfig.logger, agentId);
const storage = await createStorageManager(enrichedConfig.storage, agentId);

const agent = new DextoAgent({
    ...enrichedConfig,
    services: { logger, storageManager: storage }
});
```

**Option B**: CLI uses createAgentServices (current)
```typescript
const agent = new DextoAgent(enrichedConfig, configPath);
await agent.start();  // Creates all services
```

**Considerations:**
- **Option A**: More control, CLI can customize instance creation
- **Option A**: Better aligns with library usage patterns
- **Option B**: Simpler, less code change
- **Option B**: createAgentServices stays internal

**Recommendation**: Start with Option B (minimal change), migrate to Option A in Phase 4 when factories are mature.

### 4. How do we handle service interdependencies?

**Question**: Some services depend on others (e.g., ToolManager needs MCPManager). How do we handle this when users inject services?

**Option A**: Users must provide all dependencies
```typescript
const mcpManager = new MCPManager(config, logger);
const toolManager = new ToolManager(mcpManager);  // ← User wires dependencies

const agent = new DextoAgent({
    llm: { /* ... */ },
    services: { mcpManager, toolManager }
});
```

**Option B**: Agent creates missing dependencies automatically
```typescript
const mcpManager = new MCPManager(config, logger);

const agent = new DextoAgent({
    llm: { /* ... */ },
    services: { mcpManager }  // ← Agent creates ToolManager
});

await agent.start();  // Creates ToolManager with provided MCPManager
```

**Recommendation**: Option B - Agent creates missing services automatically. Validate that all dependencies are satisfied (either provided or creatable from config).

---

## Success Criteria

- [ ] **Zero breaking changes**: All existing code works without modification
- [ ] **Three usage styles work**: Full config, hybrid, full instances
- [ ] **CLI unchanged**: YAML files work exactly the same
- [ ] **Type safety**: Full TypeScript autocomplete and type checking
- [ ] **Documentation complete**: Clear examples for all usage patterns
- [ ] **Tests comprehensive**: Unit and integration tests for all patterns
- [ ] **Performance acceptable**: No regression in startup time or memory usage
- [ ] **Migration guide**: Clear path for users to adopt new features

---

## Conclusion

**This is a highly valuable architectural improvement that should be implemented.**

**Key Benefits:**
1. **Better Developer Experience**: Code-first API for library users
2. **Industry Alignment**: Matches patterns from Mastra, Vercel AI SDK, LangChain
3. **More Flexible**: Users can provide custom implementations
4. **Better Testability**: Easy to inject mocks
5. **Future-Proof**: Scales as Dexto grows as a library
6. **Zero Breaking Changes**: CLI and existing library code unchanged

**Recommended Approach:**
- Implement in phases (service injection → factories → union types → CLI enrichment)
- Start simple (optional service injection)
- Gradually add flexibility (instance OR config)
- Maintain backward compatibility throughout
- Document all three usage styles clearly

**Timeline**: 42-56 hours (~1.5-2 weeks) for full implementation including documentation and testing.

**Next Steps:**
1. Review this proposal
2. Make decisions on open questions
3. Begin Phase 1 implementation (service injection foundation)
4. Iterate based on feedback
