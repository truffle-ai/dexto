# Logger & Storage Migration Plan (Legacy Notes)

> **Note:** This document captures an earlier draft that explored introducing a shared `DextoBase` logger host. The current strategy uses direct logger injection (see `03-logging-config.md` and `core-logger-browser-plan.md`). Keep this file for historical context only.

## Executive Summary

This document outlines the migration strategy for Dexto's logger and storage architecture to achieve proper browser compatibility and dependency injection. The current architecture uses a global singleton logger pattern that creates tight coupling and makes browser support hacky. We will migrate to a console-by-default logger with explicit injection points, similar in spirit to Mastra's approach but adapted for Dexto's needs.

## Current State Analysis

### Problems Identified

1. **Global Singleton Pattern**
   - 39 files directly import and use `logger` singleton
   - No way to inject different implementations for different environments
   - Creates tight coupling throughout the codebase

2. **Browser Compatibility Hacks**
   - Separate `logger.ts` (Node/Winston) and `browser.ts` (console wrapper) implementations
   - Relies on package.json conditional exports and bundler intelligence
   - Storage uses error-based fallbacks that catch ALL errors, not just import failures

3. **Service Architecture Issues**
   - None of the service constructors accept logger parameters
   - Services include: MCPManager, SessionManager, StorageManager, ToolManager, ContextManager
   - Even utility functions (getDextoPath, schema validation) import the global logger

4. **Storage Fallback Problems**
   ```typescript
   try {
       const module = await import('./backend/sqlite-backend.js');
       SQLiteBackend = module.SQLiteBackend;
       return new SQLiteBackend(config);
   } catch (error) {
       // DANGER: Catches ALL errors, not just import failures!
       // Could silently degrade to in-memory storage on permission errors, disk full, etc.
       logger.warn('Falling back to in-memory database backend');
       return new MemoryBackend();
   }
   ```

### Comparison with Mastra

We analyzed Mastra's approach and found:

1. **Base Class Pattern**: All components extend `MastraBase` which provides logger
2. **Default ConsoleLogger**: Browser-safe by default
3. **Parameter Injection for Utils**: Utility functions receive logger as parameter when needed
4. **No Global Singletons**: Everything is injected or inherited

## Design Decisions

After careful analysis, we've decided on a **hybrid approach**:

### 1. Injected Logger for Services
- `DextoAgent` holds a pluggable `ILogger`, defaulting to a `ConsoleLogger`.
- Services receive an `ILogger` via constructor parameters/options rather than pulling a singleton.
- Utility modules only log when a logger is provided; otherwise they remain pure.

### 2. Parameter Injection for Utilities
- Utility functions will accept optional logger parameter
- Most utilities should be pure functions (no logger needed)
- Only add logger parameter when absolutely necessary

### 3. Explicit Environment Detection for Storage
- Replace error-based fallbacks with explicit browser detection
- Use `typeof window !== 'undefined'` checks
- Fail fast on real errors instead of silently degrading

### Why This Approach?

**Why Injected Logger?**
- ✅ Keeps core browser-safe (console logger only) until hosts opt into heavier transports.
- ✅ Makes dependencies explicit and testable.
- ✅ Avoids global singletons while staying flexible for future transports.

**Why Not Global Singleton?**
- Current problem - creates tight coupling
- Can't inject different implementations
- Makes testing difficult

## Implementation Plan

### Phase 1: Create Base Infrastructure

#### 1.1 Create Logger Interface
```typescript
// packages/core/src/logger/types.ts
export interface ILogger {
  error(message: string, meta?: any, color?: ChalkColor): void;
  warn(message: string, meta?: any, color?: ChalkColor): void;
  info(message: string, meta?: any, color?: ChalkColor): void;
  http(message: string, meta?: any, color?: ChalkColor): void;
  verbose(message: string, meta?: any, color?: ChalkColor): void;
  debug(message: string | object, meta?: any, color?: ChalkColor): void;
  silly(message: string, meta?: any, color?: ChalkColor): void;
  
  // Display methods
  displayAIResponse(response: any): void;
  toolCall(toolName: string, args: any): void;
  toolResult(result: any): void;
  displayStartupInfo(info: any): void;
  displayError(message: string, error?: Error): void;
  
  // Configuration
  setLevel(level: string): void;
  getLevel(): string;
  getLogFilePath(): string | null;
}
```

#### 1.2 Update Existing Loggers to Implement Interface
- Ensure both `logger.ts` (Winston) and `browser.ts` (Console) implement ILogger
- Keep backward compatibility during migration

#### 1.3 Create DextoBase Class
```typescript
// packages/core/src/base/DextoBase.ts
import { ILogger } from '../logger/types.js';
import { ConsoleLogger } from '../logger/console.js';

export interface BaseOptions {
  logger?: ILogger;
  name?: string;
}

export abstract class DextoBase {
  protected logger: ILogger;
  protected readonly name: string;
  
  constructor(options?: BaseOptions) {
    this.name = options?.name ?? this.constructor.name;
    // Default to ConsoleLogger - works in browser and Node
    this.logger = options?.logger ?? new ConsoleLogger({ name: this.name });
  }
  
  // Allow runtime logger updates (useful for testing)
  setLogger(logger: ILogger): void {
    this.logger = logger;
  }
  
  getLogger(): ILogger {
    return this.logger;
  }
}
```

### Phase 2: Migrate Services to Base Class

#### 2.1 Service Migration Order
1. **Independent Services First**
   - StorageManager
   - MCPManager
   - PromptManager
   
2. **Dependent Services**
   - ToolManager (depends on MCPManager)
   - SessionManager (depends on Storage)
   - ContextManager
   
3. **Core Agent**
   - DextoAgent (orchestrates all services)

#### 2.2 Service Migration Pattern
```typescript
// Before
export class MCPManager {
    constructor() {
        // Uses global logger
    }
}

// After
export class MCPManager extends DextoBase {
    constructor(config?: MCPConfig, options?: BaseOptions) {
        super(options);
        // Now has this.logger available
    }
}
```

#### 2.3 DextoAgent Propagation
```typescript
export class DextoAgent extends DextoBase {
  constructor(config: AgentConfig, options?: { logger?: ILogger }) {
    super(options);
    
    // Pass logger to all child services
    const baseOptions = { logger: this.logger };
    
    this.mcpManager = new MCPManager(config.mcp, baseOptions);
    this.storageManager = new StorageManager(config.storage, baseOptions);
    this.sessionManager = new SessionManager(config.session, {
      ...baseOptions,
      storage: this.storageManager
    });
    this.toolManager = new ToolManager({
      mcpManager: this.mcpManager,
      ...config.tools,
    }, baseOptions);
    // ... etc for all services
  }
}
```

### Phase 3: Fix Storage Fallback Logic

#### 3.1 Replace Error-Based Fallback with Explicit Detection
```typescript
private async createSQLiteBackend(config: SqliteBackendConfig): Promise<DatabaseBackend> {
    // Explicit browser check
    if (typeof window !== 'undefined') {
        this.logger.info('Browser environment detected, using in-memory storage');
        return new MemoryBackend({ logger: this.logger });
    }
    
    try {
        // Check if module exists (import failure)
        const moduleExists = await import('better-sqlite3')
            .then(() => true)
            .catch(() => false);
        
        if (!moduleExists) {
            this.logger.warn('SQLite module not installed, using in-memory storage');
            this.logger.info('To use SQLite, install: npm install better-sqlite3');
            return new MemoryBackend({ logger: this.logger });
        }
        
        // Module exists, try to create backend
        const { SQLiteBackend } = await import('./backend/sqlite-backend.js');
        const backend = new SQLiteBackend(config, { logger: this.logger });
        
        // Verify connection works
        await backend.connect();
        this.logger.info(`SQLite database initialized at ${config.path}`);
        return backend;
        
    } catch (error) {
        // Real error - don't silently fallback
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`SQLite initialization failed: ${errorMessage}`);
        
        // Check for common issues
        if (errorMessage.includes('permission')) {
            throw new StorageError('Insufficient permissions to create SQLite database', error);
        } else if (errorMessage.includes('ENOSPC')) {
            throw new StorageError('Insufficient disk space for SQLite database', error);
        }
        
        // Unknown error - throw, don't silently degrade
        throw new StorageError('Failed to initialize SQLite storage', error);
    }
}
```

#### 3.2 Similar Updates for Redis and PostgreSQL Backends
- Apply same pattern: explicit checks, clear error messages, fail fast on real errors

### Phase 4: Update Utility Functions

#### 4.1 Categorize Utilities
1. **Pure Functions** (no logger needed) - Most utilities
   - `resolveApiKey`, `toError`, `zodToIssues`, etc.
   
2. **Functions Needing Logger** (rare)
   - `getDextoPath` (currently logs debug info)
   - Schema validation warnings

#### 4.2 Update Functions That Need Logger
```typescript
// Option A: Optional logger parameter
export function getDextoPath(
  type: string,
  filename?: string,
  options?: { logger?: ILogger }
): string {
  const logger = options?.logger;
  // ...
  logger?.debug(`Dexto env path: ${envPath}, context: ${context}`);
  // ...
}

// Option B: Return debug info instead of logging
export function getDextoPath(
  type: string,
  filename?: string
): { path: string; context: string; debugInfo?: string } {
  // ...
  return {
    path: finalPath,
    context,
    debugInfo: `Dexto env path: ${envPath}, context: ${context}`
  };
}
```

### Phase 5: Create Browser-Specific Entry Points

#### 5.1 Browser-Safe Factory Functions
```typescript
// packages/core/src/agent/browser.ts
import { DextoAgent } from './DextoAgent.js';
import { ConsoleLogger } from '../logger/console.js';
import { MemoryBackend } from '../storage/memory.js';

export function createBrowserAgent(config: AgentConfig) {
  // Ensure browser-safe defaults
  const logger = new ConsoleLogger();
  
  // Override storage to in-memory for browser
  const browserConfig = {
    ...config,
    storage: {
      ...config.storage,
      database: { type: 'in-memory' as const },
      cache: { type: 'in-memory' as const }
    }
  };
  
  return new DextoAgent(browserConfig, { logger });
}
```

#### 5.2 Update Package Exports
```typescript
// packages/core/package.json
{
  "exports": {
    ".": {
      "browser": {
        "types": "./dist/index.browser.d.ts",
        "import": "./dist/index.browser.js"
      },
      "node": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    },
    "./browser": {
      "types": "./dist/agent/browser.d.ts",
      "import": "./dist/agent/browser.js"
    }
  }
}
```

### Phase 6: Migration Execution

#### 6.1 Migration Order
1. **Week 1**: Create base infrastructure (Phase 1)
   - Implement ILogger interface
   - Create DextoBase class
   - Update existing loggers

2. **Week 2**: Migrate core services (Phase 2)
   - Start with independent services
   - Update DextoAgent to propagate logger
   - Test each service migration

3. **Week 3**: Fix storage and utilities (Phases 3-4)
   - Update storage fallback logic
   - Migrate utility functions
   - Remove global logger imports

4. **Week 4**: Browser support and cleanup (Phases 5-6)
   - Create browser entry points
   - Update documentation
   - Remove deprecated code

#### 6.2 Testing Strategy
- Add unit tests for DextoBase
- Test logger injection in each service
- Test browser compatibility with bundler
- Test storage fallback scenarios explicitly

#### 6.3 Backward Compatibility
- Keep global logger export during migration
- Mark as deprecated with migration guide
- Remove in next major version

## Success Criteria

1. **No Global Logger Imports**: All 39 files updated to use injected logger
2. **Browser Compatibility**: Can import and use DextoAgent in browser without hacks
3. **Explicit Storage Fallback**: Storage backends fail fast on real errors
4. **Consistent Architecture**: All services extend DextoBase
5. **Pure Utilities**: Most utility functions have no logger dependency
6. **Comprehensive Tests**: All changes covered by tests

## Rollback Plan

If issues arise during migration:

1. **Partial Rollback**: Can roll back individual services (they're backward compatible)
2. **Global Logger Fallback**: Keep global logger as emergency fallback
3. **Feature Flag**: Use environment variable to toggle between old/new behavior

## Documentation Updates

1. **Migration Guide**: For users upgrading
2. **Architecture Docs**: Explain base class pattern
3. **Browser Usage Guide**: How to use Dexto in browser
4. **API Documentation**: Update all service constructors

## Future Considerations

1. **Telemetry**: Could add to DextoBase alongside logger
2. **Configuration**: Could add config validation to base class
3. **Event Bus**: Could add event emitter to base class
4. **Metrics**: Could add performance metrics to base class

## Conclusion

This migration plan addresses the core architectural issues while minimizing disruption. By using a base class pattern similar to Mastra but adapted for Dexto's needs, we achieve:

- **Better separation of concerns**: Services have state, utilities are pure
- **True browser compatibility**: No hacks or workarounds needed
- **Improved testability**: Can inject mock loggers
- **Clear error handling**: Storage fails fast on real errors
- **Maintainable architecture**: Consistent patterns throughout

The phased approach allows for incremental migration with the ability to rollback if needed. The end result will be a more robust, flexible, and maintainable codebase that works seamlessly in both Node.js and browser environments.
