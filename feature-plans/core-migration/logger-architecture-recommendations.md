# Logger Architecture Recommendations from Mastra Analysis

## Executive Summary

After analyzing Mastra's logging architecture, I've identified several patterns that would significantly improve Dexto's logger design while maintaining our config-first philosophy. The key insight: **Mastra separates logger configuration (framework-level) from logger usage (component-level)** through dependency injection.

Phased implementation to reduce risk and scope:
- Phase A (foundational): Console + File transports, structured LogEntry shape, per‑agent instances, component metadata, sensible rotation defaults.
- Phase B (optional/advanced): Remote/Upstash transport and query APIs after Phase A is stable.

---

## Key Patterns from Mastra

### 1. Framework-Level Dependency Injection

**Mastra Pattern:**
```typescript
// User creates Mastra instance with logger
const mastra = new Mastra({
  agents: { myAgent },
  logger: new PinoLogger({ name: 'App', level: 'debug' })  // ← Configured once
});

// Logger automatically injected into all agents
// Agents never instantiate their own logger
```

**Current Dexto Problem:**
```typescript
// packages/core/src/logger/logger.ts:198
this.logFilePath = getDextoPath('logs', 'dexto.log');  // ← Logger decides its own path
```

**Recommended Dexto Pattern:**
```typescript
// CLI creates logger and injects it
const logger = new DextoLogger({
  logPath: path.join(basePath, 'logs', agentId, 'dexto.log'),
  level: 'info'
});

const agent = new DextoAgent({
  ...config,
  logger  // ← Injected, not instantiated internally
});
```

### 2. Transport-Based Architecture

**Mastra Pattern:**
```typescript
// Logger can have multiple output destinations
const logger = new PinoLogger({
  name: 'App',
  transports: {
    file: new FileTransport({ path: './logs/app.log' }),
    upstash: new UpstashTransport({
      upstashUrl: process.env.UPSTASH_URL,
      upstashToken: process.env.UPSTASH_TOKEN
    })
  }
});
```

**Benefits:**
- Stream-based processing (efficient)
- Multiple simultaneous destinations
- Pluggable backends (file, Redis, HTTP, etc.)
- Batching and buffering built-in

**Current Dexto Limitation:**
- Single output (file or console)
- Hard-coded file path
- No streaming or batching

**Recommended Enhancement:**
```typescript
// Config specifies transports
logger:
  transports:
    - type: file
      path: ~/.dexto/logs/{agentId}/dexto.log
      maxSize: 10485760    # default 10MB rotation size
      maxFiles: 5          # default keep 5 rotated files
    - type: upstash
      url: $UPSTASH_REDIS_REST_URL
      token: $UPSTASH_REDIS_REST_TOKEN
  level: info
```

### 3. Smart Environment-Aware Defaults

**Mastra Pattern:**
```typescript
const levelOnEnv =
  process.env.NODE_ENV === 'production' && process.env.MASTRA_DEV !== 'true'
    ? LogLevel.WARN   // Production: less verbose
    : LogLevel.INFO;  // Development: more verbose

logger = new ConsoleLogger({ name: 'Mastra', level: levelOnEnv });
```

**Recommended for Dexto:**
```typescript
// In CLI enrichment
function getDefaultLogLevel(): LogLevel {
  if (process.env.NODE_ENV === 'production') {
    return 'warn';
  }
  if (process.env.DEXTO_DEBUG === 'true') {
    return 'debug';
  }
  return 'info';
}

export function enrichAgentConfig(agentId: string, userConfig: Partial<AgentConfig>) {
  return {
    ...userConfig,
    logger: {
      logPath: path.join(basePath, 'logs', agentId, 'dexto.log'),
      level: getDefaultLogLevel(),
      transports: ['file', 'console'],
      ...userConfig.logger  // User can override
    }
  };
}
```

### 4. Structured Logging Built-In

**Mastra Pattern:**
```typescript
// All log methods accept structured data
this.logger.info('Agent started', {
  agentId: this.id,
  modelConfig: this.model,
  timestamp: Date.now()
});

this.logger.error('Model validation failed', {
  agentName: config.name,
  providedModel: config.model,
  errorCode: 'MISSING_MODEL'
});
```

**Current Dexto Usage:**
```typescript
// Template literals only
logger.info(`Server running at ${url}`);
logger.error(`Failed to load config: ${error.message}`);
```

**Recommended Enhancement:**
```typescript
// Overload signature to support both patterns
class DextoLogger {
  info(message: string): void;
  info(message: string, context: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void {
    const entry = {
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...context
    };
    this.transports.forEach(t => t.write(entry));
  }
}

// Usage
logger.info('Agent started', {
  agentId: 'my-agent',
  executionContext: 'dexto-source'
});

// Backward compatible
logger.info('Server running');
```

Minimal, uniform log entry (applies in Phase A):
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO
  component: DextoLogComponent;
  agentId: string;
  context?: Record<string, any>;
}
```

### 5. Component-Based Categorization

**Mastra Pattern:**
```typescript
// Each component type has a category
export const RegisteredLogger = {
  AGENT: 'AGENT',
  WORKFLOW: 'WORKFLOW',
  LLM: 'LLM',
  STORAGE: 'STORAGE',
  MCP_SERVER: 'MCP_SERVER',
  // ... etc
} as const;

// Logger knows its context
this.logger = new ConsoleLogger({
  name: `${this.component} - ${this.name}`
});
```

**Recommended for Dexto:**
```typescript
// Add component context to logs
export enum DextoLogComponent {
  AGENT = 'AGENT',
  LLM = 'LLM',
  MCP = 'MCP',
  STORAGE = 'STORAGE',
  SESSION = 'SESSION',
  TOOL = 'TOOL',
  PLUGIN = 'PLUGIN',
  API = 'API',
  CLI = 'CLI'
}

// In service initialization
const logger = new DextoLogger({
  logPath: config.logger.logPath,
  component: DextoLogComponent.AGENT,
  agentId: effectiveAgentId
});

// All logs include component metadata
// [2025-01-15T10:30:45.123Z] [AGENT:my-agent] Agent started
// [2025-01-15T10:30:45.456Z] [MCP:my-agent] Connected to filesystem server
// [2025-01-15T10:30:46.789Z] [LLM:my-agent] Streaming response from OpenAI
```

### 6. Per-Agent Logger Instances

**Mastra Pattern:**
- Each agent gets its own logger instance
- Logger injected during agent registration
- Can be dynamically updated via `setLogger()`

**Current Dexto:**
- Singleton logger shared across all agents
- No per-agent log file isolation

**Recommended Architecture:**
```typescript
// Each agent gets isolated logger
export async function createAgentServices(
    config: ValidatedAgentConfig,
    configPath?: string,
    agentId?: string
): Promise<AgentServices> {
    const effectiveAgentId =
        agentId ||
        config.agentCard?.name ||
        path.basename(configPath, path.extname(configPath)) ||
        'default-agent';

    // Create per-agent logger
    const logger = new DextoLogger({
        logPath: config.logger!.logPath,  // Already enriched by CLI
        level: config.logger!.level,
        component: DextoLogComponent.AGENT,
        agentId: effectiveAgentId,
        transports: config.logger!.transports
    });

    // Pass to all services
    const storageManager = await createStorageManager(
        config.storage,
        effectiveAgentId,
        logger  // ← Injected
    );

    const mcpManager = new McpManager(
        config.mcpServers,
        logger  // ← Injected
    );

    // ... etc

    return {
        logger,  // ← Returned as part of services
        mcpManager,
        toolManager,
        storageManager,
        // ...
    };
}
```

---

## Applying to Our Migration Plan

### Phase 1 Enhancement: Logger Config + Interface

**Current Plan:**
```typescript
const LoggerConfigSchema = z.object({
    logPath: z.string().optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    enableFileLogging: z.boolean().default(true),
}).optional();
```

**Enhanced Plan (Mastra-Inspired):**
```typescript
// Transport configuration
const LoggerTransportSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('file'),
        path: z.string().describe('File path for logs'),
        maxSize: z.number().optional().describe('Max file size before rotation (bytes)').default(10 * 1024 * 1024),
        maxFiles: z.number().optional().describe('Max number of rotated files to keep').default(5),
    }),
    z.object({
        type: z.literal('console'),
        colorize: z.boolean().default(true)
    }),
    z.object({
        type: z.literal('upstash'),
        url: z.string().describe('Upstash Redis REST URL'),
        token: z.string().describe('Upstash Redis REST token'),
        listName: z.string().default('dexto-logs'),
        maxListLength: z.number().default(10000),
        batchSize: z.number().default(100)
    })
]);

const LoggerConfigSchema = z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    transports: z.array(LoggerTransportSchema).default([
        { type: 'console', colorize: true }
    ]).describe('Log output destinations')
}).optional().describe('Logger configuration');
```

Implementation phases recap:
- Phase A: Implement `ConsoleTransport`, `FileTransport` (with rotation using `maxSize`/`maxFiles`), structured `LogEntry`, per‑agent instances and component tagging. Ship tests and docs. Skip query APIs.
- Phase B: Add `UpstashTransport` and optional `getLogs` query support if needed.

**YAML Example:**
```yaml
logger:
  level: info
  transports:
    - type: file
      path: ~/.dexto/logs/my-agent/dexto.log
      maxSize: 10485760  # 10MB
      maxFiles: 5
    - type: console
      colorize: true
    # Optional: Remote logging
    # - type: upstash
    #   url: $UPSTASH_REDIS_REST_URL
    #   token: $UPSTASH_REDIS_REST_TOKEN
    #   listName: dexto-logs
    #   batchSize: 100
```

### Phase 2 Enhancement: Logger Interface

**Add to `packages/core/src/logger/`:**

```typescript
// logger/types.ts
export interface IDextoLogger {
    debug(message: string, context?: Record<string, any>): void;
    info(message: string, context?: Record<string, any>): void;
    warn(message: string, context?: Record<string, any>): void;
    error(message: string, context?: Record<string, any>): void;

    // Structured error tracking
    trackException(error: Error, context?: Record<string, any>): void;

    // Query support (if transport supports it)
    getLogs?(params: LogQueryParams): Promise<LogEntry[]>;
}

export interface LogEntry {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
    component: DextoLogComponent;
    agentId: string;
    context?: Record<string, any>;
}

export interface LogQueryParams {
    agentId?: string;
    component?: DextoLogComponent;
    level?: 'debug' | 'info' | 'warn' | 'error';
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
}
```

```typescript
// logger/transport.ts
import { Transform } from 'stream';

export abstract class LoggerTransport extends Transform {
    constructor() {
        super({ objectMode: true });
    }

    abstract write(entry: LogEntry): void;

    // Optional: Query support
    async getLogs(params: LogQueryParams): Promise<LogEntry[]> {
        return [];
    }
}
```

```typescript
// logger/transports/file.ts
import { createWriteStream, WriteStream } from 'fs';
import { LoggerTransport } from '../transport.js';

export class FileTransport extends LoggerTransport {
    private fileStream: WriteStream;
    private currentSize: number = 0;

    constructor(private config: {
        path: string;
        maxSize?: number;
        maxFiles?: number;
    }) {
        super();
        this.fileStream = createWriteStream(config.path, { flags: 'a' });
    }

    write(entry: LogEntry): void {
        const line = JSON.stringify(entry) + '\n';
        this.fileStream.write(line);

        this.currentSize += Buffer.byteLength(line);

        // Handle rotation if needed
        if (this.config.maxSize && this.currentSize > this.config.maxSize) {
            this.rotate();
        }
    }

    private rotate(): void {
        // Implement log rotation logic
        // Similar to Mastra's approach but with size-based rotation
    }

    _transform(chunk: any, _encoding: string, callback: Function) {
        this.write(chunk);
        callback(null, chunk);
    }
}
```

```typescript
// logger/transports/console.ts
import { LoggerTransport } from '../transport.js';
import chalk from 'chalk';

export class ConsoleTransport extends LoggerTransport {
    constructor(private config: {
        colorize?: boolean;
    } = {}) {
        super();
    }

    write(entry: LogEntry): void {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const component = `[${entry.component}:${entry.agentId}]`;

        let formattedMessage = `${timestamp} ${component} ${entry.message}`;

        if (this.config.colorize) {
            const colorFn = this.getColorForLevel(entry.level);
            formattedMessage = colorFn(formattedMessage);
        }

        if (entry.context) {
            formattedMessage += '\n' + JSON.stringify(entry.context, null, 2);
        }

        console.log(formattedMessage);
    }

    private getColorForLevel(level: string) {
        switch (level) {
            case 'debug': return chalk.gray;
            case 'info': return chalk.cyan;
            case 'warn': return chalk.yellow;
            case 'error': return chalk.red;
            default: return (s: string) => s;
        }
    }

    _transform(chunk: any, _encoding: string, callback: Function) {
        this.write(chunk);
        callback(null, chunk);
    }
}
```

```typescript
// logger/logger.ts
import { IDextoLogger, LogEntry, DextoLogComponent } from './types.js';
import { LoggerTransport } from './transport.js';

export class DextoLogger implements IDextoLogger {
    private transports: LoggerTransport[];

    constructor(private config: {
        level: 'debug' | 'info' | 'warn' | 'error';
        component: DextoLogComponent;
        agentId: string;
        transports: LoggerTransport[];
    }) {
        this.transports = config.transports;
    }

    debug(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    info(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('error')) {
            this.log('error', message, context);
        }
    }

    trackException(error: Error, context?: Record<string, any>): void {
        this.error(error.message, {
            ...context,
            errorName: error.name,
            errorStack: error.stack,
            errorType: error.constructor.name
        });
    }

    private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: Record<string, any>): void {
        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            component: this.config.component,
            agentId: this.config.agentId,
            context
        };

        this.transports.forEach(transport => {
            transport.write(entry);
        });
    }

    private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
        const levels = ['debug', 'info', 'warn', 'error'];
        const configLevelIndex = levels.indexOf(this.config.level);
        const messageLevelIndex = levels.indexOf(level);
        return messageLevelIndex >= configLevelIndex;
    }
}
```

### Phase 3: CLI Logger Factory

**Add to `packages/cli/src/config/enrichment.ts`:**

```typescript
import { DextoLogger } from '@dexto/core/logger/logger.js';
import { FileTransport } from '@dexto/core/logger/transports/file.js';
import { ConsoleTransport } from '@dexto/core/logger/transports/console.js';
import { DextoLogComponent } from '@dexto/core/logger/types.js';

export function createLoggerFromConfig(
    agentId: string,
    config: LoggerConfig
): DextoLogger {
    const transports = config.transports.map(tc => {
        switch (tc.type) {
            case 'file':
                return new FileTransport({
                    path: tc.path,
                    maxSize: tc.maxSize,
                    maxFiles: tc.maxFiles
                });
            case 'console':
                return new ConsoleTransport({
                    colorize: tc.colorize
                });
            case 'upstash':
                return new UpstashTransport({
                    url: tc.url,
                    token: tc.token,
                    listName: tc.listName,
                    batchSize: tc.batchSize
                });
            default:
                throw new Error(`Unknown transport type: ${(tc as any).type}`);
        }
    });

    return new DextoLogger({
        level: config.level,
        component: DextoLogComponent.AGENT,
        agentId,
        transports
    });
}

export function enrichAgentConfig(
    agentId: string,
    userConfig: Partial<AgentConfig>
): { config: AgentConfig; logger: DextoLogger } {
    const context = getExecutionContext();
    const basePath = getDextoPath(context);

    // Enrich logger config
    const loggerConfig: LoggerConfig = {
        level: getDefaultLogLevel(),
        transports: [
            {
                type: 'file',
                path: path.join(basePath, 'logs', agentId, 'dexto.log'),
                maxSize: 10485760,  // 10MB
                maxFiles: 5
            },
            {
                type: 'console',
                colorize: true
            }
        ],
        ...userConfig.logger
    };

    // Create logger instance
    const logger = createLoggerFromConfig(agentId, loggerConfig);

    // Return enriched config AND logger instance
    return {
        config: {
            ...userConfig,
            logger: loggerConfig,
            storage: { /* ... */ },
            // ... rest of config
        } as AgentConfig,
        logger  // ← Logger instance for injection
    };
}
```

### Phase 4: Update Service Initialization

**Update `packages/core/src/utils/service-initializer.ts`:**

```typescript
export async function createAgentServices(
    config: ValidatedAgentConfig,
    logger: IDextoLogger,  // ← Injected from CLI
    configPath?: string,
    agentId?: string
): Promise<AgentServices> {
    const effectiveAgentId =
        agentId ||
        config.agentCard?.name ||
        path.basename(configPath, path.extname(configPath)) ||
        'default-agent';

    // Create component-specific loggers
    const storageLogger = logger.createChild(DextoLogComponent.STORAGE);
    const mcpLogger = logger.createChild(DextoLogComponent.MCP);
    const llmLogger = logger.createChild(DextoLogComponent.LLM);

    // Initialize services with injected loggers
    const storageManager = await createStorageManager(
        config.storage,
        effectiveAgentId,
        storageLogger
    );

    const mcpManager = new McpManager(
        config.mcpServers,
        mcpLogger
    );

    // ... etc

    return {
        logger,
        mcpManager,
        toolManager,
        storageManager,
        // ...
    };
}
```

---

## Updated Migration Plan Summary

### New Phase 1: Logger Architecture Overhaul

- [ ] Create logger interface (`IDextoLogger`)
- [ ] Create transport base class (`LoggerTransport`)
- [ ] Implement `FileTransport` with rotation
- [ ] Implement `ConsoleTransport` with colors
- [ ] Implement `DextoLogger` with multi-transport support
- [ ] Add `DextoLogComponent` enum
- [ ] Add structured logging support (context objects)
- [ ] Update logger config schema with transports

**Estimated Time**: 12-16 hours

### New Phase 2: CLI Logger Factory

- [ ] Create `createLoggerFromConfig()` function
- [ ] Update `enrichAgentConfig()` to return logger instance
- [ ] Add smart environment-aware defaults
- [ ] Support per-agent log paths

**Estimated Time**: 4-6 hours

### New Phase 3: Dependency Injection

- [ ] Update `createAgentServices()` signature to accept logger
- [ ] Remove all `getDextoPath()` calls from logger instantiation
- [ ] Pass logger to all services that need it
- [ ] Update DextoAgent constructor to accept logger

**Estimated Time**: 6-8 hours

### New Phase 4: Update All Services

- [ ] Update SQLite store to use injected logger
- [ ] Update Blob store to use injected logger
- [ ] Update MCP manager to use injected logger
- [ ] Update all other services to use injected logger
- [ ] Remove logger instantiation from services

**Estimated Time**: 8-10 hours

### New Phase 5: Testing & Documentation

- [ ] Unit tests for transports
- [ ] Integration tests for multi-transport logging
- [ ] Test per-agent log isolation
- [ ] Test structured logging with context
- [ ] Update documentation with transport examples

**Estimated Time**: 8-10 hours

**New Total Estimate**: 38-50 hours (~1.5 weeks)

---

## Comparison: Before vs After

### Before (Current)

```typescript
// Logger decides its own path
class Logger {
    constructor() {
        this.logFilePath = getDextoPath('logs', 'dexto.log');  // ← Hardcoded
    }
}

// Services instantiate logger internally
const logger = Logger.getInstance();
logger.info(`Server started`);  // ← No structure, shared across agents
```

### After (Mastra-Inspired)

```typescript
// CLI creates and injects logger
const { config, logger } = enrichAgentConfig('my-agent', rawConfig);

const services = await createAgentServices(config, logger);

// Services use injected logger
logger.info('Server started', {
    port: 3000,
    agentId: 'my-agent',
    executionContext: 'dexto-source'
});

// Logs go to multiple destinations
// File: ~/.dexto/logs/my-agent/dexto.log
// Console: [10:30:45] [AGENT:my-agent] Server started
// Upstash: { level: 'info', message: 'Server started', ... }
```

---

## Key Benefits

1. **Serverless Compatible**: Logger doesn't decide paths, config does
2. **Per-Agent Isolation**: Each agent gets its own logger with isolated log files
3. **Flexible Routing**: Multiple transports (file, console, remote services)
4. **Structured Logging**: Rich metadata for better observability
5. **Query Support**: Can query logs by agent, component, date range
6. **Production Ready**: Built on proven patterns (Pino, streaming)
7. **Testable**: Interface-based design allows easy mocking
8. **Backward Compatible**: Template literal usage still works

---

## Open Questions

1. **Should we adopt Pino under the hood?**
   - **Pros**: Battle-tested, high-performance, rich ecosystem
   - **Cons**: Additional dependency
   - **Recommendation**: Yes, for file transport. Console can be custom.

2. **Should we support UpstashTransport in core?**
   - **Pros**: Enables remote logging out-of-the-box
   - **Cons**: Upstash-specific, requires credentials
   - **Recommendation**: Optional transport, documented in examples

3. **Should we migrate existing Logger class or create new?**
   - **Option A**: Refactor existing Logger class (breaking change)
   - **Option B**: Create new DextoLogger, deprecate old Logger
   - **Recommendation**: Option A - clean break, clearer migration path

4. **Do we need MultiLogger pattern?**
   - **Use case**: Send logs to multiple destinations simultaneously
   - **Alternative**: Built into DextoLogger with transports array
   - **Recommendation**: Built-in multi-transport support (simpler API)

5. **Should logger be in config or injected separately?**
   - **Mastra**: Injected separately from config
   - **Dexto**: Config-first philosophy suggests it should be in config
   - **Recommendation**: Hybrid - config specifies logger settings, CLI creates instance and injects it

---

## Migration Strategy for Users

### Strategy 1: Automatic Migration (Recommended)

CLI automatically enriches configs with logger settings:

```yaml
# User's minimal config (before)
llm:
  provider: openai
  model: gpt-5-mini

# CLI enriches to (after)
llm:
  provider: openai
  model: gpt-5-mini

logger:
  level: info
  transports:
    - type: file
      path: ~/.dexto/logs/my-agent/dexto.log
      maxSize: 10485760
      maxFiles: 5
    - type: console
      colorize: true
```

### Strategy 2: Explicit Configuration (Advanced)

Power users can customize logger:

```yaml
logger:
  level: debug
  transports:
    - type: file
      path: /var/log/dexto/my-agent.log
      maxSize: 52428800  # 50MB
      maxFiles: 10
    - type: upstash
      url: $UPSTASH_REDIS_REST_URL
      token: $UPSTASH_REDIS_REST_TOKEN
      listName: production-dexto-logs
      batchSize: 200
```

### Strategy 3: Programmatic (Future)

Code-first API:

```typescript
import { DextoAgent } from '@dexto/core';
import { PinoLogger, FileTransport, UpstashTransport } from '@dexto/core/logger';

const agent = new DextoAgent({
    llm: { /* ... */ },
    logger: new PinoLogger({
        level: 'debug',
        transports: [
            new FileTransport({ path: './logs/agent.log' }),
            new UpstashTransport({ /* ... */ })
        ]
    })
});
```

---

## Conclusion

Mastra's logging architecture provides a robust, flexible foundation that aligns well with our goals:

1. **Dependency Injection**: Solves the path utilities problem
2. **Transport Architecture**: Enables flexible log routing
3. **Structured Logging**: Improves observability
4. **Per-Agent Isolation**: Natural fit for multi-agent scenarios

**Recommendation**: Adopt Mastra's patterns with Dexto's config-first adaptations.

The enhanced migration plan adds ~10-12 hours to the original estimate but delivers significantly better architecture that will serve Dexto well as it scales.
