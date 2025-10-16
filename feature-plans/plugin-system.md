# Dexto Plugin System Specification

**Version:** 4.0
**Date:** 2025-01-16
**Status:** In Progress - Infrastructure Complete

**Progress:**
- ✅ Core infrastructure implemented (10 commits on `plugins-2` branch)
- ✅ All quality checks passing (build, tests, lint, typecheck)
- ⏳ Built-in plugins (ContentPolicy, ResponseSanitizer) - Pending
- ⏳ Extension point integration (4 sites) - Pending
- ⏳ Non-Node.js fallback - Pending

## Table of Contents
0. [Background & Context](#background--context)
1. [Architecture Overview](#architecture-overview)
2. [Plugin Loading Strategy](#plugin-loading-strategy)
3. [YAML Configuration Schema](#yaml-configuration-schema)
4. [Plugin Interface (TypeScript)](#plugin-interface-typescript)
5. [Plugin Execution Flow](#plugin-execution-flow)
6. [Integration with Existing Architecture](#integration-with-existing-architecture)
7. [Built-In Plugins](#built-in-plugins)
8. [Example: Tenant Auth Plugin](#example-tenant-auth-plugin)
9. [Serverless Deployment Considerations](#serverless-deployment-considerations)
10. [Migration Plan from PR #385](#migration-plan-from-pr-385)
11. [Implementation Checklist](#implementation-checklist)
12. [Design Decisions](#design-decisions)

---

## Background & Context

### The Problem Statement

This plugin system design emerged from a conversation about **making Dexto agents multi-tenant** when deployed as a service. A client raised specific concerns about:

1. **Data scoping:** How to ensure tenant A cannot access tenant B's sessions, conversations, or resources
2. **Tool access control:** How to restrict which tools different tenants can use (e.g., one tenant gets filesystem access, another doesn't)
3. **Extensibility:** How to implement tenant-specific business logic (quotas, billing, audit trails) without coupling it deeply to the core architecture
4. **Proprietary logic:** How to keep multi-tenancy business logic proprietary while Dexto core remains open-source

### Initial Exploration

The conversation started with recommendations for tenant-aware API layers, middleware-based enforcement, and storage key namespacing. However, a critical gap was identified:

**Tool Access Control Problem:** Tools execute inside the agent loop during LLM inference, not just at the API boundary. The flow is:
```
User → API → DextoAgent.run() → LLM decides to call tool →
ToolManager.executeTool() → MCPManager.callTool() → execution
```

Blocking tools at the REST endpoint doesn't prevent the LLM from requesting them. We needed **runtime enforcement inside the agent loop**.

### Discovery: PR #385 Hooks Implementation

During research into Dexto's codebase, we discovered an in-progress hooks implementation (PR #385) that provides:

- **4 hook sites** at critical execution points:
  - `beforeLLMRequest` - Before user input sent to LLM
  - `beforeToolCall` - Before tool execution
  - `afterToolResult` - After tool execution
  - `beforeResponse` - Before response sent to user

- **Built-in hooks** for common needs:
  - `ContentPolicyBuiltin` - Input validation, PII redaction, length limits
  - `ResponseSanitizerBuiltin` - Response PII redaction, truncation
  - `NotificationsBuiltin` - Logging and monitoring

- **YAML configuration** for built-in hooks with simple options
- **Notice system** for user feedback about policy enforcement
- **Session context** flows through all hooks (enables per-session/tenant logic)

**Critical Insight:** The hooks infrastructure provides the exact integration points needed for multi-tenant access control, but it was designed for built-in functionality only, not user-extensible code.

### Research: OpenSearch Plugin Architecture

To understand industry patterns for extensible plugin systems, we researched OpenSearch's plugin architecture:

**Key Learnings:**
1. **Marker interfaces** define extension points (ActionPlugin, SearchPlugin, etc.)
2. **File-based discovery** from `plugin-descriptor.properties`
3. **Dependency management** with topological sorting and cycle detection
4. **Rich context objects** passed to plugins (Parameters with all services)
5. **Fail-fast on errors** at load time, but extensibility for runtime behavior
6. **ClassLoader isolation** prevents plugin conflicts

**What We Borrowed:**
- Interface-based extension point definition
- File-based plugin declaration
- Priority/ordering system
- Rich context passing
- Fail-fast validation at startup

**What We Avoided:**
- Complex dependency graphs (too complex for Dexto's scale)
- Guice dependency injection (not idiomatic for Node.js)
- Unordered execution (need deterministic behavior)
- Implicit plugin discovery (explicit is clearer)

### Evolution of the Design

**Initial Idea:** Hook-based plugins that register callbacks
- Problem: Two parallel systems (hooks vs plugins)
- Complexity: Confusion about hooks vs plugins vs built-in hooks

**Second Iteration:** Wrapper/middleware pattern around DextoAgent
- Problem: Doesn't solve tool execution control (happens deep in agent loop)
- Problem: Tight coupling at API layer only

**Third Iteration (PR #385 Discovery):** Extend the hooks system
- Problem: Hooks were configuration-driven (YAML options), not code-driven
- Problem: No mechanism for users to provide custom code

**Final Design (This Spec):** Unified plugin system that replaces hooks
- ✅ Single system for both built-in and user plugins
- ✅ User-written TypeScript code in plugin files
- ✅ Configured via YAML (file paths, priority, blocking behavior)
- ✅ 4 extension points from PR #385 (proven integration sites)
- ✅ Generic enough for multi-tenancy AND other use cases
- ✅ Clean separation: core stays open-source, business logic in user plugins

### Why This Approach

**1. Simplicity:** One extension mechanism (plugins), not multiple (hooks + plugins + built-ins)

**2. Flexibility:** Users write arbitrary TypeScript code at predefined extension points

**3. Decoupling:** Core provides extension points, plugins implement business logic
- Core doesn't know about tenancy, quotas, billing, or auth
- Multi-tenant logic lives in user-written plugins (can be proprietary)

**4. Proven Integration Points:** The 4 extension points from PR #385 are exactly where we need control:
- `beforeLLMRequest` - Quota enforcement, input validation, auth checks
- `beforeToolCall` - Tool access control, permission validation
- `afterToolResult` - Audit logging, usage tracking
- `beforeResponse` - Response filtering, PII redaction

**5. Proprietary-Friendly:**
- Core plugin system is generic (open-source MIT/Apache)
- Business logic plugins are user-written (can be proprietary)
- Example: `@dexto/enterprise` package with tenant auth plugin (private npm)

**6. Configuration-Driven:** Matches Dexto's philosophy
- Plugins declared in YAML
- Path resolution like file prompt contributors (`{{dexto.agent_dir}}`)
- Enable/disable without code changes
- Priority ordering configurable

**7. Future-Proof:**
- Can add more extension points later
- Can add plugin dependencies later
- Can add versioning later
- Start simple, evolve as needed

### How Multi-Tenancy Works with Plugins

**Application layer** (Express API):
1. Resolves tenant from JWT/API key in middleware
2. Sets `tenantId` and `userId` in AsyncLocalStorage
3. Creates ExecutionContext with tenant info
4. Passes to agent

**Plugin layer** (user-written tenant-auth plugin):
1. Receives `beforeToolCall` with ExecutionContext containing `tenantId`
2. Queries storage: "What tools can this tenant use?"
3. If tool not allowed, returns `{ ok: false, cancel: true, message: '...' }`
4. Agent blocks execution, returns error to user

**Storage layer** (for tenant isolation):
- Session keys: `tenant:{tenantId}:session:{sessionId}`
- Tool permissions: `tenant:{tenantId}:allowed_tools`
- Usage tracking: `tenant:{tenantId}:usage:{date}`

**Core stays tenant-unaware** - it just executes plugins and respects their results.

### What Changed from PR #385

**Before (PR #385):**
- Hooks were "built-in configuration options" (maxInputChars, redactEmails, etc.)
- Users couldn't provide custom code
- Limited to predefined functionality
- Configuration in `hooks:` section

**After (This Design):**
- Plugins are "user-written TypeScript code"
- Users can implement arbitrary logic
- Built-in functionality becomes plugins that ship with Dexto
- Configuration in `plugins:` section with `module:` paths

**Why Replace Instead of Extend:**
- Simpler mental model (one system, not two)
- More consistent (everything is a plugin)
- Easier to maintain (one execution engine)
- More powerful (users can replace built-ins if needed)

---

## Architecture Overview

### Unified Plugin System

**Key Decision:** Replace the dual "hooks + built-in hooks" system from PR #385 with a single unified plugin system. Built-in functionality becomes plugins that ship with Dexto.

```
┌─────────────────────────────────────────────────────┐
│              USER APPLICATION                        │
│           (Express API, CLI, etc.)                   │
└────────────────┬────────────────────────────────────┘
                 │ Sets ExecutionContext
┌────────────────▼────────────────────────────────────┐
│             PLUGIN MANAGER                           │
│  - Loads plugins from YAML at startup               │
│  - Creates singleton instances                      │
│  - Registers to 4 extension points                  │
│  - Manages execution order (priority)               │
└────────────────┬────────────────────────────────────┘
                 │ Executes plugins sequentially
┌────────────────▼────────────────────────────────────┐
│          EXTENSION POINTS (4 sites)                  │
│  1. beforeLLMRequest                                │
│  2. beforeToolCall                                  │
│  3. afterToolResult                                 │
│  4. beforeResponse                                  │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│            DEXTO AGENT CORE                         │
│  (LLM services, tool execution, sessions)           │
└─────────────────────────────────────────────────────┘
```

### Core Principles

1. **Simplicity First**: Linear execution order, no plugin dependencies
2. **Configurable Safety**: Per-plugin blocking/non-blocking behavior
3. **Created Once**: Plugin instances created at startup, reused for all requests
4. **Stateless Design**: Context passed at runtime via ExecutionContext
5. **Explicit Configuration**: Plugins declared in YAML, no auto-discovery
6. **Environment Variables for Secrets**: No secrets in config files
7. **Observable**: Logging for all plugin execution (OTEL metrics TODO)
8. **Fail-Fast**: Plugin initialization failures crash the agent (cannot run with broken plugins)

---

## Plugin Loading Strategy

### MVP Approach: Local Files Only

**Supported Formats:**
- `.ts` files (TypeScript) - Recommended for development
- `.js` files (JavaScript/ESM) - Required for production builds

**Loading Mechanism:**
```typescript
// Pseudo-code for plugin loader
async function loadPlugin(modulePath: string): Promise<DextoPlugin> {
  // Dynamic import for both .ts and .js files
  const module = await import(modulePath);

  // Extract default export (must implement DextoPlugin)
  const PluginClass = module.default;

  if (!PluginClass) {
    throw new Error(`Plugin at ${modulePath} has no default export`);
  }

  // Instantiate the plugin
  return new PluginClass();
}
```

**Runtime TypeScript Support:**
- Use `tsx` loader when available for `.ts` files
- Fallback to plain import if tsx not available
- Production deployments should pre-compile to `.js`

### Path Resolution

**Only absolute paths are accepted** after template variable expansion. This ensures configuration is explicit and not dependent on runtime working directory.

**Supported Path Patterns:**

```yaml
plugins:
  # Built-in plugins - referenced by name (no module path)
  contentPolicy:
    priority: 10
    maxInputChars: 10000

  # User plugins with template variable (recommended)
  custom:
    - module: "${{dexto.agent_dir}}/plugins/tenant-auth.ts"

    # Explicit absolute path
    - module: "/opt/dexto/plugins/custom.js"
```

**Rejected Patterns:**
```yaml
plugins:
  custom:
    # ❌ Relative paths NOT supported
    - module: "./plugins/audit.ts"
    - module: "plugins/audit.ts"
```

**Template Variable Expansion:**
- `${{dexto.agent_dir}}` expands to the absolute directory containing the agent config file
- Happens during config loading in `packages/core/src/config/loader.ts`
- After expansion, paths must be absolute or will be rejected
- Matches the pattern used by system prompt file contributors

### File Structure Best Practices

```
agents/
├── default-agent.yml
└── plugins/
    ├── tenant-auth.ts      # Multi-tenant authorization
    ├── audit-logger.ts     # Audit logging
    └── billing-tracker.ts  # Usage tracking for billing
```

### Initialization Behavior

**Fail-Fast Policy:**
- If any plugin's `initialize()` method fails, **agent startup fails**
- No partial initialization - all plugins must load successfully
- Clear error messages indicating which plugin failed and why

```typescript
// During agent initialization
for (const pluginConfig of config.plugins) {
  try {
    const plugin = await loadPlugin(pluginConfig.module);
    await plugin.initialize?.(pluginConfig.config);
    registeredPlugins.push({ plugin, config: pluginConfig });
  } catch (error) {
    // FAIL FAST - crash the agent
    throw new DextoRuntimeError(
      `Failed to initialize plugin '${pluginConfig.name}'`,
      { cause: error, type: ErrorType.PLUGIN_INITIALIZATION_FAILED }
    );
  }
}
```

### Plugin Validation

**Runtime shape validation** ensures loaded plugins implement the `DextoPlugin` interface correctly.

```typescript
// packages/core/src/plugins/loader.ts

function validatePluginShape(plugin: any, pluginName: string): void {
  // 1. Check it's a class/constructor
  if (typeof plugin !== 'function') {
    throw new DextoRuntimeError(
      `Plugin '${pluginName}' default export must be a class`,
      { type: ErrorType.PLUGIN_INVALID_SHAPE }
    );
  }

  // 2. Instantiate to check constructor
  let instance: any;
  try {
    instance = new plugin();
  } catch (error) {
    throw new DextoRuntimeError(
      `Failed to instantiate plugin '${pluginName}'`,
      { cause: error, type: ErrorType.PLUGIN_INSTANTIATION_FAILED }
    );
  }

  // 3. Check it has at least one extension point method
  const extensionPoints = [
    'beforeLLMRequest',
    'beforeToolCall',
    'afterToolResult',
    'beforeResponse'
  ];

  const hasExtensionPoint = extensionPoints.some(
    point => typeof instance[point] === 'function'
  );

  if (!hasExtensionPoint) {
    throw new DextoRuntimeError(
      `Plugin '${pluginName}' must implement at least one extension point method`,
      {
        type: ErrorType.PLUGIN_INVALID_SHAPE,
        context: { availablePoints: extensionPoints }
      }
    );
  }

  // 4. Validate initialize if present
  if (instance.initialize && typeof instance.initialize !== 'function') {
    throw new DextoRuntimeError(
      `Plugin '${pluginName}' initialize must be a function`,
      { type: ErrorType.PLUGIN_INVALID_SHAPE }
    );
  }

  // 5. Validate cleanup if present
  if (instance.cleanup && typeof instance.cleanup !== 'function') {
    throw new DextoRuntimeError(
      `Plugin '${pluginName}' cleanup must be a function`,
      { type: ErrorType.PLUGIN_INVALID_SHAPE }
    );
  }
}

// Usage in PluginManager.initialize()
const pluginModule = await import(modulePath);
const PluginClass = pluginModule.default;

if (!PluginClass) {
  throw new Error(`Plugin at ${modulePath} has no default export`);
}

// Validate shape before instantiation
validatePluginShape(PluginClass, pluginConfig.name);

// Safe to instantiate
const plugin = new PluginClass();
```

**Validation Checks:**
1. ✅ Default export exists
2. ✅ Default export is a class (function)
3. ✅ Class can be instantiated (constructor works)
4. ✅ At least one extension point method exists
5. ✅ `initialize()` and `cleanup()` are functions (if present)

**TypeScript Limitations:**
- Runtime validation cannot verify method signatures match `DextoPlugin` interface exactly
- Can only check that methods exist and are functions
- Type safety is provided by TypeScript at development time
- Plugin authors should use `implements DextoPlugin` for compile-time checking

### Future Extensions (TODOs)

**TODO: npm Package Support**
```yaml
plugins:
  - module: "@mycompany/dexto-tenant-plugin"  # from node_modules
```
- Would enable versioned, publishable plugins
- Requires package resolution and version management
- Consider for post-MVP

**TODO: Hot Reloading**
- Watch plugin files for changes
- Reload plugins without restarting agent
- Useful for development workflow

**TODO: Plugin Compilation Pipeline**
- Build step to compile all .ts plugins to .js
- Optimize for production deployments
- Part of `dexto bundle` CLI command

---

## YAML Configuration Schema

### Full Example

```yaml
# agents/my-agent.yml

# ... existing agent config (llm, storage, etc.) ...

plugins:
  # Built-in plugins - referenced by name (config-driven activation)
  contentPolicy:
    priority: 10  # Lower priority = runs first
    maxInputChars: 10000
    redactEmails: true
    redactApiKeys: true

  responseSanitizer:
    priority: 900  # Runs near the end
    redactEmails: true
    redactApiKeys: true
    maxResponseLength: 50000

  # User custom plugins - require module path
  custom:
    - name: tenant-auth
      module: "${{dexto.agent_dir}}/plugins/tenant-auth.ts"
      enabled: true
      blocking: true
      priority: 100  # Runs after built-ins
      config:
        enforceQuota: true
        checkToolAccess: true

    - name: audit-logger
      module: "${{dexto.agent_dir}}/plugins/audit.ts"
      enabled: true
      blocking: false
      priority: 1000  # Runs last for audit logging
      config:
        logToFile: /var/log/dexto-audit.log
        includePayload: false
```

### Configuration Formats

**Two configuration formats are supported:**

#### 1. Built-In Plugins (Referenced by Name)

```yaml
plugins:
  contentPolicy:           # Built-in name
    priority: 10
    maxInputChars: 10000
    redactEmails: true
```

Built-in plugins follow the PR #385 hooks pattern:
- Referenced by **configuration object name** (e.g., `contentPolicy`, `responseSanitizer`)
- No `module` field required (automatically resolved from built-in registry)
- Presence of config object enables the plugin
- Config fields are plugin-specific

**Available Built-Ins:**
- `contentPolicy` - Input validation, PII redaction, length limits
- `responseSanitizer` - Response PII redaction, truncation

#### 2. Custom User Plugins (Require Module Path)

```yaml
plugins:
  custom:
    - name: tenant-auth
      module: "${{dexto.agent_dir}}/plugins/tenant-auth.ts"
      enabled: true
      blocking: true
      priority: 100
      config:
        enforceQuota: true
```

**Configuration Fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | - | Unique identifier for debugging/logging |
| `module` | string | Yes | - | **Absolute path** to plugin file (supports `${{dexto.agent_dir}}` template) |
| `enabled` | boolean | No | true | Whether to load this plugin |
| `blocking` | boolean | No | true | If plugin cancels, should execution stop? |
| `priority` | number | Yes | - | Execution order (**lower = earlier**, must be unique across ALL plugins) |
| `config` | object | No | {} | Plugin-specific configuration |

### Priority System

**IMPORTANT: Lower priority = runs first**

This matches the system prompt contributor convention in Dexto.

```yaml
plugins:
  - name: auth          # priority: 10  - runs FIRST
  - name: validation    # priority: 100 - runs second
  - name: logging       # priority: 500 - runs third
  - name: audit         # priority: 900 - runs LAST
```

**Validation Rules:**
- Priority must be unique across all enabled plugins
- If two plugins have the same priority, agent fails to start
- Priority can be any integer (negative or positive)

**Rationale for Lower-First:**
- Matches Dexto's system prompt contributor convention
- Critical plugins (auth) typically need low numbers
- Easier to reason about ordering visually

### Path Resolution Rules

**Only absolute paths are supported** (after template expansion):

- `${{dexto.agent_dir}}/path/to/plugin.ts` - **Recommended** - Expands to absolute path based on agent config location
- `/absolute/path/to/plugin.ts` - Explicit absolute path
- ❌ `./relative/path.ts` - **NOT SUPPORTED** - Relative paths are rejected
- ❌ `plugins/foo.ts` - **NOT SUPPORTED** - Use `${{dexto.agent_dir}}/plugins/foo.ts` instead

**Rationale:** Absolute paths eliminate ambiguity about runtime working directory and make configuration explicit. The `${{dexto.agent_dir}}` template variable provides a convenient way to specify paths relative to the agent config file while resolving to absolute paths.

---

## Plugin Interface (TypeScript)

### Core Types

```typescript
// packages/core/src/plugins/types.ts

/**
 * Extension point names (fixed for MVP)
 */
export type ExtensionPoint =
  | 'beforeLLMRequest'
  | 'beforeToolCall'
  | 'afterToolResult'
  | 'beforeResponse';

/**
 * Plugin result - what plugins return
 */
export interface PluginResult {
  /** Did plugin execute successfully? */
  ok: boolean;

  /** Partial modifications to apply to payload */
  modify?: Record<string, any>;

  /** Should execution stop? (Only respected if plugin is blocking) */
  cancel?: boolean;

  /** User-facing message (shown when cancelled) */
  message?: string;

  /** Notices for logging/events */
  notices?: PluginNotice[];
}

export interface PluginNotice {
  kind: 'allow' | 'block' | 'warn' | 'info';
  code?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Execution context passed to every plugin method
 */
export interface ExecutionContext {
  /** Current session ID */
  sessionId?: string;

  /** User ID (set by application layer) */
  userId?: string;

  /** Tenant ID (set by application layer for multi-tenant deployments) */
  tenantId?: string;

  /** Current LLM configuration */
  llmConfig: ValidatedLLMConfig;

  /** Logger scoped to this plugin execution */
  logger: Logger;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;

  /** Reference to agent (read-only access to services) */
  agent: {
    readonly sessionManager: SessionManager;
    readonly mcpManager: MCPManager;
    readonly toolManager: ToolManager;
    readonly stateManager: AgentStateManager;
    readonly agentEventBus: AgentEventBus;
    readonly storage: StorageBackends;
  };
}

/**
 * Payloads for each extension point
 */
export interface BeforeLLMRequestPayload {
  text: string;
  imageData?: { image: string; mimeType: string };
  fileData?: { data: string; mimeType: string; filename?: string };
  sessionId?: string;
}

export interface BeforeToolCallPayload {
  toolName: string;
  args: any;
  sessionId?: string;
  callId?: string;
}

export interface AfterToolResultPayload {
  toolName: string;
  result: any;
  success: boolean;
  sessionId?: string;
  callId?: string;
}

export interface BeforeResponsePayload {
  content: string;
  reasoning?: string;
  provider: string;
  model?: string;
  router?: string;
  tokenUsage?: { input: number; output: number };
  sessionId?: string;
}

/**
 * Main plugin interface - implement any subset of these methods
 */
export interface DextoPlugin {
  /** Called once at plugin initialization (before agent starts) */
  initialize?(config: Record<string, any>): Promise<void>;

  /** Extension point: before LLM request */
  beforeLLMRequest?(
    payload: BeforeLLMRequestPayload,
    context: ExecutionContext
  ): Promise<PluginResult>;

  /** Extension point: before tool call */
  beforeToolCall?(
    payload: BeforeToolCallPayload,
    context: ExecutionContext
  ): Promise<PluginResult>;

  /** Extension point: after tool result */
  afterToolResult?(
    payload: AfterToolResultPayload,
    context: ExecutionContext
  ): Promise<PluginResult>;

  /** Extension point: before response */
  beforeResponse?(
    payload: BeforeResponsePayload,
    context: ExecutionContext
  ): Promise<PluginResult>;

  /** Called when agent shuts down (cleanup) */
  cleanup?(): Promise<void>;
}

/**
 * Plugin configuration from YAML
 */
export interface PluginConfig {
  name: string;
  module: string;
  enabled: boolean;
  blocking: boolean;
  priority: number;
  config?: Record<string, any>;
}
```

### Plugin Type Exports

All plugin-related types are exported from `@dexto/core`:

```typescript
// User plugin file
import type {
  DextoPlugin,
  ExecutionContext,
  PluginResult,
  BeforeToolCallPayload,
  // ... other types
} from '@dexto/core';

export default class MyPlugin implements DextoPlugin {
  // implementation
}
```

---

## Plugin Execution Flow

### Startup Flow

```
Agent Initialization
  ↓
Read Agent Config (YAML)
  ↓
Create Services (storage, MCP, etc.)
  ↓
Create PluginManager
  ↓
Register Built-In Plugins (from registry)
  ↓
Discover Custom Plugins from Config
  ↓
Validate Priority Uniqueness (built-in + custom, fail if duplicates)
  ↓
For Each Plugin (built-in and custom):
  ├─ Resolve module path (${{dexto.agent_dir}}, validate absolute)
  ├─ Dynamic import (await import(path))
  ├─ Validate default export exists
  ├─ Validate plugin shape (runtime checks)
  ├─ Instantiate plugin
  ├─ Call plugin.initialize(config) if exists
  │   └─ If fails: CRASH AGENT with clear error
  ├─ Store in plugin registry
  └─ Sort by priority (LOW to HIGH)
  ↓
Plugin system ready
  ↓
Continue service initialization (tools, sessions)
  ↓
Agent starts normally
```

### Runtime Execution (Sequential Pass-Through)

```
Extension Point Triggered (e.g., beforeToolCall)
  ↓
Get all plugins registered for this point
  ↓
Sort by priority (LOW to HIGH - so low priority runs first)
  ↓
Initialize: payload = original, cancelled = false
  ↓
For each plugin (in order):
  ├─ Skip if plugin doesn't implement this method
  ├─ Skip if previous plugin cancelled & was blocking
  ├─ Create ExecutionContext with current state
  ├─ Call: result = await plugin.beforeToolCall(payload, context)
  ├─ Log execution (plugin name, duration, result.ok)
  ├─ If result.ok === false:
  │   ├─ Log error/warning
  │   ├─ If plugin.blocking === true:
  │   │   └─ Set cancelled = true, stop chain
  │   └─ Else: continue to next plugin
  ├─ If result.modify: merge into payload
  ├─ If result.cancel && plugin.blocking:
  │   └─ Return error to user with result.message
  └─ Emit notices/metrics
  ↓
Return final payload (or error if cancelled)
  ↓
Continue agent execution with modified payload
```

### Error Handling Pseudo-Code

```typescript
async function executePlugins(
  extensionPoint: ExtensionPoint,
  payload: any,
  context: ExecutionContext
): Promise<{ ok: boolean; payload: any; message?: string }> {
  const plugins = getPluginsForExtensionPoint(extensionPoint);

  // Sort by priority: LOW to HIGH (lower runs first)
  plugins.sort((a, b) => a.config.priority - b.config.priority);

  let currentPayload = { ...payload };

  for (const { plugin, config } of plugins) {
    // Skip if not enabled
    if (!config.enabled) continue;

    // Skip if doesn't implement this method
    const method = plugin[extensionPoint];
    if (!method) continue;

    try {
      // Execute with timeout (5 seconds default)
      const result = await Promise.race([
        method.call(plugin, currentPayload, context),
        timeout(5000, `Plugin '${config.name}' timed out`)
      ]);

      // Log execution
      logger.debug(`Plugin '${config.name}' executed`, {
        extensionPoint,
        ok: result.ok,
        cancelled: result.cancel,
        duration: '...'
      });

      // Handle result
      if (!result.ok) {
        logger.warn(`Plugin '${config.name}' returned error`, result);

        if (config.blocking && result.cancel) {
          // Blocking plugin wants to stop execution
          return {
            ok: false,
            payload: currentPayload,
            message: result.message || 'Operation blocked by plugin'
          };
        }
        // Non-blocking: continue to next plugin
        continue;
      }

      // Apply modifications
      if (result.modify) {
        currentPayload = { ...currentPayload, ...result.modify };
      }

      // Check cancellation
      if (result.cancel && config.blocking) {
        return {
          ok: false,
          payload: currentPayload,
          message: result.message || 'Operation cancelled'
        };
      }

    } catch (error) {
      // Plugin threw exception
      logger.error(`Plugin '${config.name}' threw error`, error);

      if (config.blocking) {
        // Blocking plugin failed - stop execution
        return {
          ok: false,
          payload: currentPayload,
          message: `Plugin '${config.name}' failed: ${error.message}`
        };
      }
      // Non-blocking: continue
    }
  }

  return { ok: true, payload: currentPayload };
}
```

---

## Integration with Existing Architecture

This section provides detailed guidance on how the plugin system integrates with Dexto's existing service architecture, including exact file locations, method names, and initialization sequences.

### Service Initialization Flow

The plugin system integrates into the existing service initializer at `packages/core/src/utils/service-initializer.ts`. Here's the complete initialization sequence:

```typescript
// packages/core/src/utils/service-initializer.ts

export async function createAgentServices(
  config: ValidatedAgentConfig,
  configPath?: string
): Promise<AgentServices> {
  // 1. Agent Event Bus (for cross-service communication)
  const agentEventBus = new AgentEventBus();

  // 2. Storage Backends (cache + database)
  const storageResult = await createStorageBackends(config.storage);
  const storage = storageResult.backends;
  const storageManager = storageResult.manager;

  // 3. MCP Manager (Model Context Protocol server management)
  const mcpManager = new MCPManager();
  await mcpManager.initializeFromConfig(config.mcpServers);

  // 4. Search Service (conversation search)
  const searchService = new SearchService(storage.database);

  // 5. Plugin Manager (NEW - replaces HookManager)
  const pluginManager = new PluginManager(config.plugins, {
    agentEventBus,
    storage,
    configDir: configPath ? dirname(resolve(configPath)) : process.cwd()
  });

  // Register built-in plugins from registry
  registerBuiltInPlugins({ pluginManager, config });

  // Initialize all plugins (built-in + custom)
  await pluginManager.initialize();

  // 6. Tool Confirmation Provider
  const allowedToolsProvider = createAllowedToolsProvider({
    type: config.toolConfirmation.allowedToolsStorage,
    storage
  });
  const confirmationProvider = createToolConfirmationProvider(...);

  // 7. Tool Manager (with plugin manager)
  const toolManager = new ToolManager(mcpManager, confirmationProvider, {
    internalToolsServices: { searchService },
    internalToolsConfig: config.internalTools,
    pluginManager  // NEW - pass plugin manager
  });
  await toolManager.initialize();

  // 8. Prompt Manager (system prompt building)
  const configDir = configPath ? dirname(resolve(configPath)) : process.cwd();
  const promptManager = new PromptManager(config.systemPrompt, configDir);

  // 9. State Manager (runtime config tracking)
  const stateManager = new AgentStateManager(config, agentEventBus);

  // 10. Session Manager (conversation management)
  const sessionManager = new SessionManager(
    {
      stateManager,
      promptManager,
      toolManager,
      agentEventBus,
      storage,
      pluginManager  // NEW - pass plugin manager
    },
    config.sessions
  );
  await sessionManager.init();

  return {
    mcpManager,
    toolManager,
    promptManager,
    agentEventBus,
    stateManager,
    sessionManager,
    searchService,
    storage,
    storageManager,
    pluginManager  // NEW - expose in services
  };
}
```

**Key Integration Points:**
- **PluginManager created at step 5** - After storage and MCP, before tools
- **Passed to ToolManager** - For `beforeToolCall`/`afterToolResult` integration
- **Passed to SessionManager** - For `beforeLLMRequest`/`beforeResponse` integration
- **Returned in AgentServices** - Exposed to DextoAgent for advanced usage

### PluginManager Class Structure

```typescript
// packages/core/src/plugins/manager.ts

export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginsByExtensionPoint: Map<ExtensionPoint, LoadedPlugin[]> = new Map();

  constructor(
    config: PluginConfig[],
    private context: {
      agentEventBus: AgentEventBus;
      storage: StorageBackends;
      configDir: string;
    }
  ) {
    // Store for later initialization
  }

  /**
   * Loads all plugins from config and initializes them.
   * Called during service initialization (step 5).
   * THROWS if any plugin fails to load or initialize (fail-fast).
   */
  async initialize(): Promise<void> {
    // 1. Validate priority uniqueness
    const priorities = new Set<number>();
    for (const pluginConfig of config) {
      if (!pluginConfig.enabled) continue;
      if (priorities.has(pluginConfig.priority)) {
        throw new DextoRuntimeError(
          `Duplicate plugin priority: ${pluginConfig.priority}`,
          { type: ErrorType.PLUGIN_CONFIGURATION_INVALID }
        );
      }
      priorities.add(pluginConfig.priority);
    }

    // 2. Load and initialize each plugin
    for (const pluginConfig of config) {
      if (!pluginConfig.enabled) continue;

      try {
        // Resolve module path (and validate it's absolute)
        const modulePath = await this.resolveModulePath(
          pluginConfig.module,
          this.context.configDir
        );

        // Dynamic import
        const pluginModule = await import(modulePath);
        const PluginClass = pluginModule.default;

        if (!PluginClass) {
          throw new Error('Plugin has no default export');
        }

        // Validate plugin shape (runtime checks)
        validatePluginShape(PluginClass, pluginConfig.name);

        // Instantiate (safe after validation)
        const plugin = new PluginClass();

        // Initialize (MUST succeed or agent fails)
        if (plugin.initialize) {
          await plugin.initialize(pluginConfig.config || {});
        }

        // Store
        const loadedPlugin: LoadedPlugin = {
          plugin,
          config: pluginConfig
        };
        this.plugins.set(pluginConfig.name, loadedPlugin);

        // Register to extension points
        this.registerToExtensionPoints(loadedPlugin);

        logger.info(`Plugin '${pluginConfig.name}' loaded successfully`);
      } catch (error) {
        // FAIL FAST - crash agent
        throw new DextoRuntimeError(
          `Failed to initialize plugin '${pluginConfig.name}'`,
          { cause: error, type: ErrorType.PLUGIN_INITIALIZATION_FAILED }
        );
      }
    }

    // 3. Sort plugins by priority (low to high) for each extension point
    for (const [extensionPoint, plugins] of this.pluginsByExtensionPoint.entries()) {
      plugins.sort((a, b) => a.config.priority - b.config.priority);
    }

    logger.info(`PluginManager initialized with ${this.plugins.size} plugins`);
  }

  /**
   * Execute plugins at a specific extension point.
   * Returns modified payload or throws if cancelled.
   * TODO: figure out proper typing
   */
  async executePlugins(
    extensionPoint: ExtensionPoint,
    payload: any,
    context: ExecutionContext
  ): Promise<any> {
    const plugins = this.pluginsByExtensionPoint.get(extensionPoint) || [];
    let currentPayload = { ...payload };

    for (const { plugin, config } of plugins) {
      // Skip if doesn't implement this extension point
      const method = plugin[extensionPoint];
      if (!method) continue;

      // Execute with timeout
      const result = await Promise.race([
        method.call(plugin, currentPayload, context),
        this.createTimeout(config.name, 5000)
      ]);

      // Handle result (see error handling pseudo-code)
      if (!result.ok && config.blocking && result.cancel) {
        throw new DextoPluginError(
          result.message || 'Operation blocked by plugin',
          { plugin: config.name, extensionPoint, notices: result.notices }
        );
      }

      // Apply modifications
      if (result.modify) {
        currentPayload = { ...currentPayload, ...result.modify };
      }
    }

    return currentPayload;
  }
}
```

### Extension Point Integration Sites

Each of the 4 extension points is called from a specific location in the codebase:

#### 1. beforeLLMRequest

**Location:** `packages/core/src/session/chat-session.ts:242`

```typescript
// ChatSession.run() method
public async run(input: string, ...): Promise<string> {
  // Input validation done at DextoAgent level

  // Build execution context
  const context = this.buildExecutionContext({
    sessionId: this.id,
    userId: undefined,  // Set by API layer if multi-tenant
    tenantId: undefined, // Set by API layer if multi-tenant
    abortSignal: this.abortController.signal
  });

  // Execute beforeLLMRequest plugins
  const payload = await this.pluginManager.executePlugins(
    'beforeLLMRequest',
    {
      text: input,
      imageData: imageDataInput,
      fileData: fileDataInput,
      sessionId: this.id
    },
    context
  );

  // Use potentially modified payload
  const modifiedInput = payload.text;

  // Continue with LLM request...
  const response = await this.llmService.createCompletion({
    messages: [...conversationHistory, { role: 'user', content: modifiedInput }],
    ...
  });

  // ...
}
```

#### 2. beforeToolCall & 3. afterToolResult

**Location:** `packages/core/src/tools/tool-manager.ts:215` and `:314`

```typescript
// ToolManager.executeTool() method
public async executeTool(
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string,
  callId?: string
): Promise<unknown> {
  // Build execution context
  const context = this.buildExecutionContext({ sessionId, callId });

  // beforeToolCall - Execute plugins
  const beforePayload = await this.pluginManager.executePlugins(
    'beforeToolCall',
    {
      toolName,
      args,
      sessionId,
      callId
    },
    context
  );

  // Use modified args
  const processedArgs = beforePayload.args;

  // Execute tool confirmation (existing code)
  const approved = await this.confirmationProvider.requestConfirmation({
    toolName,
    args: processedArgs,
    sessionId
  });

  if (!approved) {
    throw ToolError.executionDenied(toolName, sessionId);
  }

  let result: unknown;
  let success = true;

  try {
    // Route to MCP or internal tools (existing code)
    if (toolName.startsWith(ToolManager.MCP_TOOL_PREFIX)) {
      const actualToolName = toolName.substring(ToolManager.MCP_TOOL_PREFIX.length);
      result = await this.mcpManager.executeTool(actualToolName, processedArgs, sessionId);
    } else if (toolName.startsWith(ToolManager.INTERNAL_TOOL_PREFIX)) {
      const actualToolName = toolName.substring(ToolManager.INTERNAL_TOOL_PREFIX.length);
      result = await this.internalToolsProvider.executeTool(actualToolName, processedArgs, sessionId);
    }
  } catch (error) {
    success = false;
    result = error instanceof Error ? { error: error.message } : { error: String(error) };
  }

  // afterToolResult - Execute plugins
  const afterPayload = await this.pluginManager.executePlugins(
    'afterToolResult',
    {
      toolName,
      result,
      success,
      sessionId,
      callId
    },
    context
  );

  // Use potentially modified result
  const modifiedResult = afterPayload.result;

  if (!success) {
    throw ToolError.executionFailed(toolName, modifiedResult.error, sessionId);
  }

  return modifiedResult;
}
```

#### 4. beforeResponse

**Location:** `packages/core/src/session/chat-session.ts` (after LLM response)

```typescript
// ChatSession.run() method (continued)
public async run(input: string, ...): Promise<string> {
  // ... (beforeLLMRequest and LLM request happened above)

  // Got response from LLM
  const response = await this.llmService.createCompletion(...);

  // Build execution context
  const context = this.buildExecutionContext({
    sessionId: this.id,
    userId: undefined,
    tenantId: undefined
  });

  // Execute beforeResponse plugins
  const payload = await this.pluginManager.executePlugins(
    'beforeResponse',
    {
      content: response.content,
      reasoning: response.reasoning,
      provider: this.llmConfig.provider,
      model: this.llmConfig.model,
      router: this.llmConfig.router,
      tokenUsage: response.usage,
      sessionId: this.id
    },
    context
  );

  // Use modified content
  const modifiedContent = payload.content;

  // Store in conversation history
  this.conversationHistory.push({
    role: 'assistant',
    content: modifiedContent
  });

  // Save to storage
  await this.saveHistory();

  return modifiedContent;
}
```

### ExecutionContext Construction

The `ExecutionContext` object is built at runtime and passed to every plugin method. Here's how it's constructed:

```typescript
// Helper method (can live in PluginManager or as utility function)
function buildExecutionContext(options: {
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  callId?: string;
  abortSignal?: AbortSignal;
  services: AgentServices;
  stateManager: AgentStateManager;
}): ExecutionContext {
  return {
    // From options (set by API layer or session)
    sessionId: options.sessionId,
    userId: options.userId,      // Set by API middleware in multi-tenant deployments
    tenantId: options.tenantId,  // Set by API middleware in multi-tenant deployments

    // From state manager
    llmConfig: options.stateManager.getLLMConfig(options.sessionId),

    // Logger scoped to plugin execution
    logger: logger.child({
      context: 'plugin',
      sessionId: options.sessionId,
      tenantId: options.tenantId
    }),

    // Abort signal (from session or request)
    abortSignal: options.abortSignal,

    // Read-only access to agent services
    agent: {
      sessionManager: options.services.sessionManager,
      mcpManager: options.services.mcpManager,
      toolManager: options.services.toolManager,
      stateManager: options.services.stateManager,
      agentEventBus: options.services.agentEventBus,
      storage: options.services.storage
    }
  };
}
```

**Where userId/tenantId Come From:**

Multi-tenant deployments (Express API) set these fields in middleware:

```typescript
// packages/cli/src/api/server.ts (API middleware)
app.use(async (req, res, next) => {
  // Extract tenant/user from JWT or API key
  const tenantId = await extractTenantFromAuth(req.headers.authorization);
  const userId = await extractUserFromAuth(req.headers.authorization);

  // Store in AsyncLocalStorage or request context
  req.context = { tenantId, userId };

  next();
});

// Later, when calling agent
app.post('/api/message', async (req, res) => {
  const { tenantId, userId } = req.context;

  // Pass to agent (implementation detail TBD)
  // Option A: agent.run() accepts context parameter
  // Option B: AsyncLocalStorage pattern (preferred)
  const response = await agent.run(req.body.text, undefined, undefined, sessionId);

  res.json({ response });
});
```

### Multi-Tenant Context Passing

**Challenge:** How to pass `tenantId`/`userId` from API middleware to plugins deep in the execution stack.

#### Primary Approach: AsyncLocalStorage (Node.js)

Use AsyncLocalStorage for automatic context propagation:

```typescript
// packages/core/src/utils/async-context.ts
// TODO: Add fallback strategy for non-Node.js environments (browsers, edge workers)
// For now, this will work in Node.js (CLI API server, standalone deployments).
// Future: Consider session metadata fallback when AsyncLocalStorage is unavailable.

import { AsyncLocalStorage } from 'async_hooks';

const asyncContext = new AsyncLocalStorage<{
  tenantId?: string;
  userId?: string;
}>();

export function setContext(ctx: { tenantId?: string; userId?: string }) {
  return asyncContext.enterWith(ctx);
}

export function getContext() {
  return asyncContext.getStore();
}

// API middleware
app.use((req, res, next) => {
  const { tenantId, userId } = extractAuthFromRequest(req);
  setContext({ tenantId, userId });
  next();
});

// In ExecutionContext builder
const asyncCtx = getContext();
return {
  ...otherFields,
  tenantId: asyncCtx?.tenantId,
  userId: asyncCtx?.userId
};
```

**Pros:**
- ✅ Automatic propagation across async boundaries
- ✅ No API changes needed
- ✅ Clean separation of concerns
- ✅ Zero overhead when not used

**Cons:**
- ❌ **Node.js only** - won't work in browsers or edge workers
- ❌ Harder to test (implicit context)

**TODO:** For non-Node.js environments, implement one of these fallback strategies:

#### Fallback Option 1: Session Metadata

Store tenant/user info in session metadata when creating sessions:

```typescript
// API layer
app.post('/api/message', async (req, res) => {
  const { tenantId, userId } = extractAuthFromRequest(req);

  // Create or get session with metadata
  const sessionId = req.body.sessionId || `tenant:${tenantId}:${randomUUID()}`;
  const session = await agent.getSession(sessionId) ||
    await agent.createSession(sessionId);

  // Store metadata on first creation
  if (!session.metadata) {
    await sessionManager.updateSessionMetadata(sessionId, {
      tenantId,
      userId
    });
  }

  // Run normally
  const response = await agent.run(req.body.text, undefined, undefined, sessionId);
  res.json({ response });
});

// In plugins - read from session metadata
const session = await context.agent.sessionManager.getSession(context.sessionId);
const tenantId = session?.metadata?.tenantId;
```

**Pros:**
- ✅ Works everywhere (Node.js, browsers, edge workers)
- ✅ No API changes to core
- ✅ Tenant info persisted with session
- ✅ Clear ownership model (session belongs to tenant)

**Cons:**
- ❌ Requires session per tenant/user (acceptable for most cases)
- ❌ Plugins must read from session metadata (extra lookup)

#### Fallback Option 2: Explicit Context Parameter

Add optional context parameter to `agent.run()`:

```typescript
// Modified API
public async run(
  textInput: string,
  imageDataInput?: { image: string; mimeType: string },
  fileDataInput?: { data: string; mimeType: string; filename?: string },
  sessionId?: string,
  stream?: boolean,
  context?: { tenantId?: string; userId?: string }  // NEW
): Promise<string>

// Usage in API
app.post('/api/message', async (req, res) => {
  const { tenantId, userId } = extractAuthFromRequest(req);

  const response = await agent.run(
    req.body.text,
    undefined,
    undefined,
    sessionId,
    false,
    { tenantId, userId }  // Pass explicitly
  );

  res.json({ response });
});
```

**Pros:**
- ✅ Explicit and testable
- ✅ Works everywhere
- ✅ Type-safe

**Cons:**
- ❌ Requires API changes to core
- ❌ More verbose
- ❌ Breaks backward compatibility

### Error Propagation Flow

When a plugin blocks execution, the error flows back to the API layer:

```
Plugin returns { ok: false, cancel: true, message: '...' }
  ↓
PluginManager.executePlugins() throws DextoPluginError
  ↓
Caught in ChatSession.run() or ToolManager.executeTool()
  ↓
Rethrown (or wrapped) as appropriate error type
  ↓
Propagates to DextoAgent.run()
  ↓
Caught by API error middleware (packages/cli/src/api/middleware/errorHandler.ts)
  ↓
Mapped to HTTP status code:
  - DextoValidationError → 400 Bad Request
  - DextoPluginError (auth/access) → 403 Forbidden
  - DextoPluginError (quota) → 429 Too Many Requests
  - DextoRuntimeError → 500 Internal Server Error
  ↓
Response sent to client with error message
```

**Error Mapping Example:**

```typescript
// packages/cli/src/api/middleware/errorHandler.ts

function mapPluginErrorToStatus(error: DextoPluginError): number {
  // Check notice codes to determine appropriate status
  const notices = error.context?.notices || [];

  for (const notice of notices) {
    if (notice.code === 'QUOTA_EXCEEDED') return 429;
    if (notice.code === 'TOOL_NOT_ALLOWED') return 403;
    if (notice.code === 'UNAUTHORIZED') return 401;
  }

  // Default for plugin blocks
  return 403;
}
```

### Service Dependencies Summary

**PluginManager depends on:**
- `AgentEventBus` (for emitting plugin events)
- `StorageBackends` (passed to plugins via ExecutionContext)
- `configDir` (for path resolution)

**PluginManager exposes to:**
- All plugins (via ExecutionContext):
  - SessionManager (read-only)
  - MCPManager (read-only)
  - ToolManager (read-only)
  - StateManager (read-only)
  - AgentEventBus (read-only)
  - StorageBackends (read-write)

**Integration Touch Points:**
1. `service-initializer.ts` - Creates PluginManager
2. `chat-session.ts` - Calls beforeLLMRequest, beforeResponse
3. `tool-manager.ts` - Calls beforeToolCall, afterToolResult
4. `agent/DextoAgent.ts` - Exposes pluginManager publicly (optional)
5. `agent/schemas.ts` - Add plugins config schema
6. `config/loader.ts` - Already handles template vars (no changes needed)

### Type Exports

All plugin types are exported from the main package entry point:

```typescript
// packages/core/src/index.ts (add to existing exports)

export type {
  DextoPlugin,
  PluginResult,
  PluginNotice,
  ExecutionContext,
  ExtensionPoint,
  BeforeLLMRequestPayload,
  BeforeToolCallPayload,
  AfterToolResultPayload,
  BeforeResponsePayload,
  PluginConfig
} from './plugins/types.js';

export { PluginManager } from './plugins/manager.js';
```

This allows users to write plugins with full type safety:

```typescript
import type { DextoPlugin, ExecutionContext, PluginResult } from '@dexto/core';

export default class MyPlugin implements DextoPlugin {
  async beforeToolCall(payload, context: ExecutionContext): Promise<PluginResult> {
    // Full autocomplete and type checking
    return { ok: true };
  }
}
```

---

## Built-In Plugins

### Built-In Plugin Registry Pattern

Built-in plugins follow the PR #385 hooks pattern with a centralized registry:

```typescript
// packages/core/src/plugins/registrations/builtins.ts

import { PluginManager } from '../manager.js';
import type { ValidatedAgentConfig } from '@core/agent/schemas.js';
import { ContentPolicyPlugin } from './content-policy.js';
import { ResponseSanitizerPlugin } from './response-sanitizer.js';

/**
 * Register all built-in plugins based on agent configuration.
 * Called during service initialization.
 *
 * Pattern: If config object exists for a built-in, register it.
 */
export function registerBuiltInPlugins(args: {
  pluginManager: PluginManager;
  config: ValidatedAgentConfig;
}) {
  // Content Policy plugin
  const cp = args.config.plugins?.contentPolicy;
  if (cp && typeof cp === 'object') {
    args.pluginManager.registerBuiltin(
      'content-policy',
      ContentPolicyPlugin,
      {
        priority: cp.priority,
        blocking: cp.blocking ?? true,
        config: cp
      }
    );
  }

  // Response Sanitizer plugin
  const rs = args.config.plugins?.responseSanitizer;
  if (rs && typeof rs === 'object') {
    args.pluginManager.registerBuiltin(
      'response-sanitizer',
      ResponseSanitizerPlugin,
      {
        priority: rs.priority,
        blocking: rs.blocking ?? false,
        config: rs
      }
    );
  }
}
```

**Integration in Service Initializer:**

```typescript
// packages/core/src/utils/service-initializer.ts

// After PluginManager is created
const pluginManager = new PluginManager(config.plugins, { ... });

// Register built-ins before initialize()
registerBuiltInPlugins({ pluginManager, config });

// Then initialize (loads custom plugins + built-ins)
await pluginManager.initialize();
```

**Adding New Built-Ins:**

1. Create plugin class in `packages/core/src/plugins/builtins/my-plugin.ts`
2. Add schema in `packages/core/src/agent/schemas.ts`:
   ```typescript
   const PluginsConfigSchema = z.object({
     contentPolicy: z.object({ ... }).strict().optional(),
     responseSanitizer: z.object({ ... }).strict().optional(),
     myPlugin: z.object({  // NEW
       priority: z.number().int(),
       option1: z.boolean().optional(),
     }).strict().optional(),
     custom: z.array(...).optional(),
   });
   ```
3. Register in `registerBuiltInPlugins()` function
4. Export from `packages/core/src/plugins/builtins/index.ts`

**Current Built-In Plugins:**
- `contentPolicy` - Input validation, PII redaction, length limits
- `responseSanitizer` - Response PII redaction, truncation

### Content Policy Plugin

Ships with Dexto at `@dexto/core/plugins/content-policy`

```typescript
// packages/core/src/plugins/builtins/content-policy.ts

export default class ContentPolicyPlugin implements DextoPlugin {
  private config: {
    maxInputChars?: number;
    redactEmails?: boolean;
    redactApiKeys?: boolean;
  };

  async initialize(config: any) {
    this.config = config;
  }

  async beforeLLMRequest(
    payload: BeforeLLMRequestPayload,
    context: ExecutionContext
  ): Promise<PluginResult> {
    let { text } = payload;
    const notices: PluginNotice[] = [];

    // Check length
    if (this.config.maxInputChars && text.length > this.config.maxInputChars) {
      return {
        ok: false,
        cancel: true,
        message: `Input exceeds ${this.config.maxInputChars} character limit`,
        notices: [{
          kind: 'block',
          code: 'INPUT_TOO_LONG',
          message: `Input length: ${text.length}, limit: ${this.config.maxInputChars}`
        }]
      };
    }

    // Redact emails
    if (this.config.redactEmails) {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      if (emailRegex.test(text)) {
        text = text.replace(emailRegex, '[EMAIL]');
        notices.push({
          kind: 'warn',
          code: 'EMAIL_REDACTED',
          message: 'Email addresses redacted from input'
        });
      }
    }

    // Redact API keys
    if (this.config.redactApiKeys) {
      const apiKeyRegex = /\b[A-Za-z0-9_-]{32,}\b/g;
      if (apiKeyRegex.test(text)) {
        text = text.replace(apiKeyRegex, '[REDACTED]');
        notices.push({
          kind: 'warn',
          code: 'API_KEY_REDACTED',
          message: 'Potential API keys redacted from input'
        });
      }
    }

    return {
      ok: true,
      modify: text !== payload.text ? { text } : undefined,
      notices
    };
  }
}
```

### Response Sanitizer Plugin

Ships with Dexto at `@dexto/core/plugins/response-sanitizer`

```typescript
// packages/core/src/plugins/builtins/response-sanitizer.ts

export default class ResponseSanitizerPlugin implements DextoPlugin {
  private config: {
    redactEmails?: boolean;
    redactApiKeys?: boolean;
    maxResponseLength?: number;
  };

  async initialize(config: any) {
    this.config = config;
  }

  async beforeResponse(
    payload: BeforeResponsePayload,
    context: ExecutionContext
  ): Promise<PluginResult> {
    let { content } = payload;
    const notices: PluginNotice[] = [];

    // Redact emails
    if (this.config.redactEmails) {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      content = content.replace(emailRegex, '[EMAIL]');
    }

    // Redact API keys
    if (this.config.redactApiKeys) {
      const apiKeyRegex = /\b[A-Za-z0-9_-]{32,}\b/g;
      content = content.replace(apiKeyRegex, '[REDACTED]');
    }

    // Truncate if too long
    if (this.config.maxResponseLength && content.length > this.config.maxResponseLength) {
      content = content.slice(0, this.config.maxResponseLength) + '\n[Response truncated]';
      notices.push({
        kind: 'warn',
        code: 'RESPONSE_TRUNCATED',
        message: `Response truncated to ${this.config.maxResponseLength} characters`
      });
    }

    return {
      ok: true,
      modify: content !== payload.content ? { content } : undefined,
      notices
    };
  }
}
```

---

## Example: Tenant Auth Plugin

User-written multi-tenant authentication plugin.

```typescript
// agents/plugins/tenant-auth.ts

import type {
  DextoPlugin,
  ExecutionContext,
  PluginResult,
  BeforeLLMRequestPayload,
  BeforeToolCallPayload,
  AfterToolResultPayload,
} from '@dexto/core';

/**
 * Multi-tenant authentication and authorization plugin
 *
 * Responsibilities:
 * - Enforce tenant quotas before LLM requests
 * - Check tool access permissions before tool calls
 * - Audit all operations after tool execution
 */
export default class TenantAuthPlugin implements DextoPlugin {
  private config: {
    enforceQuota: boolean;
    checkToolAccess: boolean;
  };

  async initialize(config: any) {
    this.config = config;
  }

  async beforeLLMRequest(
    payload: BeforeLLMRequestPayload,
    context: ExecutionContext
  ): Promise<PluginResult> {
    if (!this.config.enforceQuota) {
      return { ok: true };
    }

    const { tenantId } = context;
    if (!tenantId) {
      // Not a multi-tenant request
      return { ok: true };
    }

    // Query tenant quota from storage
    const usage = await this.getTenantUsageToday(tenantId, context);
    const quota = await this.getTenantQuota(tenantId, context);

    if (usage.tokens >= quota.tokensPerDay) {
      return {
        ok: false,
        cancel: true,
        message: 'Daily token limit exceeded. Please upgrade your plan or try again tomorrow.',
        notices: [{
          kind: 'block',
          code: 'QUOTA_EXCEEDED',
          message: `Tenant ${tenantId} exceeded quota`,
          details: { used: usage.tokens, limit: quota.tokensPerDay }
        }]
      };
    }

    return { ok: true };
  }

  async beforeToolCall(
    payload: BeforeToolCallPayload,
    context: ExecutionContext
  ): Promise<PluginResult> {
    if (!this.config.checkToolAccess) {
      return { ok: true };
    }

    const { tenantId } = context;
    if (!tenantId) {
      return { ok: true };
    }

    // Query allowed tools for tenant
    const allowedTools = await this.getAllowedTools(tenantId, context);

    if (!allowedTools.includes(payload.toolName)) {
      return {
        ok: false,
        cancel: true,
        message: `Tool '${payload.toolName}' is not available on your plan.`,
        notices: [{
          kind: 'block',
          code: 'TOOL_NOT_ALLOWED',
          message: `Tenant ${tenantId} attempted to use restricted tool`,
          details: { toolName: payload.toolName, allowed: allowedTools }
        }]
      };
    }

    return { ok: true };
  }

  async afterToolResult(
    payload: AfterToolResultPayload,
    context: ExecutionContext
  ): Promise<PluginResult> {
    const { tenantId, userId } = context;

    // Record tool usage for billing/analytics
    await this.recordToolUsage(tenantId, payload.toolName, context);

    // Audit log
    context.logger.info('Tool execution completed', {
      tenant: tenantId,
      user: userId,
      tool: payload.toolName,
      success: payload.success,
      sessionId: payload.sessionId
    });

    return { ok: true };
  }

  // Helper methods (not part of DextoPlugin interface)
  private async getTenantUsageToday(tenantId: string, context: ExecutionContext) {
    const db = context.agent.storage.database;
    const key = `tenant:${tenantId}:usage:${new Date().toISOString().split('T')[0]}`;
    return await db.get(key) || { tokens: 0, requests: 0 };
  }

  private async getTenantQuota(tenantId: string, context: ExecutionContext) {
    const db = context.agent.storage.database;
    const key = `tenant:${tenantId}:quota`;
    return await db.get(key) || { tokensPerDay: 100000, requestsPerMinute: 60 };
  }

  private async getAllowedTools(tenantId: string, context: ExecutionContext) {
    const db = context.agent.storage.database;
    const key = `tenant:${tenantId}:allowed_tools`;
    return await db.get(key) || ['*']; // Default: all tools
  }

  private async recordToolUsage(tenantId: string, toolName: string, context: ExecutionContext) {
    const db = context.agent.storage.database;
    const key = `tenant:${tenantId}:usage:tools`;
    const usage = await db.get(key) || {};
    usage[toolName] = (usage[toolName] || 0) + 1;
    await db.set(key, usage);
  }
}
```

---

## Serverless Deployment Considerations

### Status: Deferred for MVP (Future Enhancement)

Serverless architectures (AWS Lambda, Vercel Functions, Cloudflare Workers) present unique challenges for dynamic plugin loading. This section documents what would be required to support serverless deployments in the future.

### Current Architecture Limitations

**Problem 1: Cold Start Overhead**
- Plugins loaded dynamically via `import()` on every cold start
- Adds latency to first request (100-500ms depending on plugin count)
- Cannot persist loaded plugins across invocations

**Problem 2: File System Constraints**
- Most serverless platforms have read-only file systems
- Cannot dynamically load arbitrary `.ts` files
- All code must be bundled at build time

**Problem 3: Dynamic Import Restrictions**
- Bundlers (webpack, esbuild) need static analysis
- Dynamic paths like `"{{dexto.agent_dir}}/plugins/foo.ts"` cannot be resolved at build time
- Requires all plugin paths to be known during bundling

### Proposed Solutions (Future Work)

#### Option A: Build-Time Plugin Bundling

Add a `dexto bundle` CLI command that:
1. Parses agent config to discover all plugins
2. Generates static imports for each plugin
3. Creates a plugin registry mapping names to modules
4. Bundles everything into a single deployable artifact

```bash
# Build command
dexto bundle --agent agents/default-agent.yml --output dist/

# Generated output
dist/
├── agent-bundle.js       # All code bundled
├── plugin-registry.js    # Static plugin imports
└── config.json           # Processed config
```

**Generated Plugin Registry:**
```typescript
// dist/plugin-registry.js
import contentPolicy from '@dexto/core/plugins/content-policy';
import tenantAuth from './plugins/tenant-auth.js';
import audit from './plugins/audit.js';

export const pluginRegistry = {
  'content-policy': contentPolicy,
  'tenant-auth': tenantAuth,
  'audit': audit,
};
```

**Modified Plugin Loader:**
```typescript
class PluginManager {
  async loadPlugin(config: PluginConfig) {
    if (process.env.DEXTO_RUNTIME === 'serverless') {
      // Use pre-bundled registry
      const PluginClass = pluginRegistry[config.name];
      if (!PluginClass) {
        throw new Error(`Plugin '${config.name}' not found in bundle`);
      }
      return new PluginClass();
    } else {
      // Dynamic loading (current MVP behavior)
      return await import(config.module);
    }
  }
}
```

#### Option B: Hybrid Architecture

Deploy as two layers:
- **Serverless Edge:** Lightweight API layer for routing
- **Container Core:** Long-lived agent with plugins

```
Vercel Edge Function → HTTP → Docker Container (Agent + Plugins)
```

**Benefits:**
- Serverless handles request routing and scaling
- Container provides persistent plugin loading
- Best of both worlds

**Drawbacks:**
- More complex infrastructure
- Additional network hop
- Requires container orchestration

### Future Implementation Checklist

When implementing serverless support, the following work is needed:

**Core Changes:**
- [ ] Add `DEXTO_RUNTIME` environment detection
- [ ] Implement plugin registry pattern
- [ ] Modify PluginManager to support both dynamic and registry-based loading

**Build Tooling:**
- [ ] Create `dexto bundle` CLI command
- [ ] Implement plugin path discovery from YAML
- [ ] Generate static plugin imports
- [ ] Support multiple bundler backends (webpack, esbuild, rollup)
- [ ] Optimize bundle size (tree-shaking, minification)

**Documentation:**
- [ ] Serverless deployment guide
- [ ] Build configuration examples
- [ ] Performance optimization tips
- [ ] Platform-specific guides (Vercel, AWS Lambda, Cloudflare)

**Testing:**
- [ ] Integration tests for bundled deployments
- [ ] Cold start performance benchmarks
- [ ] Multi-platform compatibility tests

### Cost Savings Potential

Serverless offers significant cost advantages for variable workloads:

**Traditional Server (t3.medium AWS):**
- ~$30/month fixed cost
- Always running, even at low usage
- Manual scaling required

**Serverless (AWS Lambda):**
- Pay-per-request pricing
- $0 cost at zero usage
- Automatic scaling
- Free tier: 1M requests/month

**Recommendation:** Defer serverless support until MVP is validated and usage patterns are understood. The complexity of bundling and cold start optimization is not justified until there's clear demand.

---

## Migration Plan from PR #385

### Current State
- `HookManager` with 4 hook sites
- Built-in hooks: `ContentPolicyBuiltin`, `ResponseSanitizerBuiltin`, `NotificationsBuiltin`
- Configuration in `hooks:` section of YAML

### Target State
- `PluginManager` with 4 extension points
- All hooks become plugins (including built-ins)
- Configuration in `plugins:` section of YAML

### Migration Phases

**Phase 1: Create Plugin System (Parallel to Hooks)**
- Add `PluginManager` class
- Define `DextoPlugin` interface
- Implement plugin loading from YAML
- Integrate with 4 extension points (parallel to hooks)
- Test with simple plugins

**Phase 2: Port Built-In Hooks to Plugins**
- Rewrite `ContentPolicyBuiltin` as `ContentPolicyPlugin`
- Rewrite `ResponseSanitizerBuiltin` as `ResponseSanitizerPlugin`
- Add to `@dexto/core/plugins/builtins/`
- Update default agent config to reference plugins instead of hooks

**Phase 3: Deprecate Hook System**
- Mark `HookManager` as deprecated
- Keep for backward compatibility (one release)
- Update docs to use `plugins:` instead of `hooks:`

**Phase 4: Remove Hook System**
- Delete `HookManager` class
- Delete built-in hook implementations
- Remove `hooks:` from config schema

---

## Implementation Checklist

### Core Infrastructure ✅ COMPLETED (2025-01-16)
- [x] Define plugin types (`packages/core/src/plugins/types.ts`)
  - Commit: cb00c557 "Add plugin system types"
- [x] Implement `PluginManager` (`packages/core/src/plugins/manager.ts`)
  - [x] Add `registerBuiltin()` method for built-in plugin registration
  - [x] Support both built-in and custom plugin loading
  - Commit: 4c087454 "Add PluginManager for orchestrating plugin execution"
- [x] Implement plugin loader with .ts/.js support (`packages/core/src/plugins/loader.ts`)
  - [x] Add runtime shape validation (`validatePluginShape()`)
  - [x] Validate paths are absolute after template expansion
  - [x] Reject relative paths with clear error messages
  - Commit: 468b60d2 "Add plugin loader with runtime validation"
- [x] Add AsyncLocalStorage utility for multi-tenant context
  - Commit: ea72b494 "Add AsyncLocalStorage utility for multi-tenant context"
- [x] Add plugin config schema to `AgentConfigSchema` with priority validation
  - [x] Schema for built-in plugins (contentPolicy, responseSanitizer)
  - [x] Schema for custom plugins (array with module paths)
  - [x] Discriminated union for two config formats
  - Commit: 4ba0c330 "Add plugin configuration schemas"
- [x] Create built-in plugin registry (`packages/core/src/plugins/registrations/builtins.ts`)
  - [x] Implement `registerBuiltInPlugins()` function stub
  - [ ] Add registration logic for each built-in (TODO - needs built-in plugins)
  - Commit: d4b388ac "Add built-in plugin registry stub"
- [x] Integrate `PluginManager` into service initializer
  - [x] Create PluginManager at step 6.5 (after storage, before tools)
  - [x] Call `registerBuiltInPlugins()` before `initialize()`
  - [x] Exposed in AgentServices
  - Commit: b5e5e83a "Integrate PluginManager into service initializer"
- [x] Implement path resolution (`${{dexto.agent_dir}}`)
  - [x] Template expansion happens in config loader (already exists)
  - [x] Validation that paths are absolute post-expansion
  - Included in loader implementation
- [x] Add logging for plugin execution (built into PluginManager)
- [x] Add error handling with fail-fast initialization (built into PluginManager)
- [x] Add timeout handling (5 seconds default in PluginManager)
- [x] Validate priority uniqueness on startup (in PluginManager.initialize())
- [x] Add plugin error codes (`packages/core/src/plugins/error-codes.ts`)
- [x] Export plugin types from `@dexto/core`
  - Commit: 9ee85dc2 "Export plugin types from core package"
- [x] All quality checks passing
  - Commit: 67ffc5be "Fix lint warnings and test failures"

### Built-In Plugins (Next Phase)
- [ ] Port `ContentPolicy` from feat/hooks branch to plugin
  - Source: `feat/hooks:packages/core/src/hooks/registrations/content-policy.ts`
  - Target: `packages/core/src/plugins/builtins/content-policy.ts`
- [ ] Port `ResponseSanitizer` from feat/hooks branch to plugin
  - Source: `feat/hooks:packages/core/src/hooks/registrations/response-sanitizer.ts`
  - Target: `packages/core/src/plugins/builtins/response-sanitizer.ts`
- [ ] Add plugin barrel (`packages/core/src/plugins/builtins/index.ts`)
- [ ] Complete `registerBuiltInPlugins()` implementation
- [ ] Update default agent config with correct priorities

### Extension Point Integration (Next Phase)
- [ ] Add plugin execution to 4 extension sites
  - [ ] `chat-session.ts` - beforeLLMRequest extension point
  - [ ] `chat-session.ts` - beforeResponse extension point
  - [ ] `tool-manager.ts` - beforeToolCall extension point
  - [ ] `tool-manager.ts` - afterToolResult extension point
- [ ] Wire ExecutionContext construction (get tenantId/userId from AsyncLocalStorage)
- [ ] Pass PluginManager to ToolManager and SessionManager constructors

### Testing (Future Phase)
- [ ] Unit tests for `PluginManager`
  - [ ] Test `registerBuiltin()` method
  - [ ] Test priority uniqueness validation (built-in + custom)
  - [ ] Test plugin execution chaining
- [ ] Unit tests for plugin loader (both .ts and .js)
  - [ ] Test runtime shape validation
  - [ ] Test absolute path validation
  - [ ] Test relative path rejection
  - [ ] Test template variable expansion
- [ ] Unit tests for built-in plugin registry
  - [ ] Test `registerBuiltInPlugins()` function
  - [ ] Test config-driven activation
- [ ] Integration tests with sample plugins
  - [ ] Test built-in plugins (contentPolicy, responseSanitizer)
  - [ ] Test custom plugins loading
  - [ ] Test mixed built-in and custom plugins
- [ ] Test blocking vs non-blocking behavior
- [ ] Test error handling and fail-fast initialization
- [ ] Test priority ordering (lower = earlier)
- [ ] Test priority uniqueness validation (built-in and custom together)
- [ ] Test plugin timeout
- [ ] Test multi-tenant context via AsyncLocalStorage

### Type Exports ✅ COMPLETED
- [x] Export all plugin types from `@dexto/core`
- [ ] Verify TypeScript autocomplete works for plugin authors (needs testing with actual plugins)
- [ ] Document type imports in plugin developer guide (documentation phase)

### Documentation
- [ ] Plugin developer guide
- [ ] Built-in plugin reference
- [ ] Migration guide from hooks
- [ ] Example: tenant auth plugin
- [ ] Example: audit logging plugin
- [ ] Update CLAUDE.md with plugin guidelines
- [ ] Document serverless limitations and future plans

### TODOs for Future
- [ ] TODO: Add fallback for multi-tenant context in non-Node.js environments
  - Session metadata approach for browsers/edge workers
  - Automatic detection of AsyncLocalStorage availability
  - Seamless fallback when unavailable
- [ ] TODO: Add OpenTelemetry metrics for plugin execution
- [ ] TODO: Add performance profiling
- [ ] TODO: Add plugin dependency system (if needed)
- [ ] TODO: Add plugin versioning (when API stabilizes)
- [ ] TODO: Add npm package support for plugins
- [ ] TODO: Implement `dexto bundle` CLI for serverless deployments
- [ ] TODO: Add hot reloading for development
- [ ] TODO: Add plugin compilation pipeline

---

## Design Decisions

### Answered Questions

1. **Plugin Lifecycle State:** Plugins created once at startup, reused for all requests
2. **Plugin Dependencies:** Linear execution only (no dependencies)
3. **Plugin Modification Authority:** Plugins cannot disable/modify other plugins
4. **Error Behavior:** Configurable blocking/non-blocking per plugin; initialization failures crash agent
5. **Payload Modification:** Can modify any field (restrictions can be added later)
6. **Plugin Versioning:** Ignore for MVP (early stage)
7. **Plugin Discovery:** Explicit YAML specification (no auto-discovery)
8. **Configuration Scope:** Env vars for secrets, minimal config fields
9. **Multi-Process:** Each process loads plugins independently, state is per-process, shared state via storage backends
10. **Observability:** Logging for now, OpenTelemetry metrics as TODO
11. **Plugin Loading:** Support both .ts and .js files; local files only for MVP
12. **Priority Semantics:** Lower priority = runs first (matches system prompt contributor convention)
13. **Priority Uniqueness:** Must be unique across all enabled plugins (both built-in and custom); agent fails to start on conflict
14. **Serverless Support:** Deferred for MVP; requires bundling strategy documented above
15. **Built-In Plugin Pattern:** Reference by name in config (following PR #385 hooks pattern); registry auto-wires them
16. **Path Resolution:** Only absolute paths allowed; relative paths rejected; use `${{dexto.agent_dir}}` template for agent-relative paths
17. **Plugin Validation:** Runtime shape validation ensures plugins implement at least one extension point
18. **Multi-Tenant Context:** Use AsyncLocalStorage for Node.js deployments; TODO: implement fallback for non-Node.js environments (session metadata or explicit parameter)

### Key Architectural Choices

**Unified System:** Replace dual hooks+built-ins with single plugin system
- **Rationale:** Simpler mental model, easier maintenance, user-extensible

**Sequential Pass-Through:** Plugins execute in priority order, each sees previous modifications
- **Rationale:** Clear data flow, easier debugging, matches Express middleware pattern

**Stateless Plugins:** Context passed at runtime, not stored in plugin instance
- **Rationale:** Better for multi-tenant, easier testing, no shared state issues

**Blocking/Non-Blocking:** Per-plugin configuration
- **Rationale:** Auth plugins must block, audit plugins should not block

**Fail-Fast Initialization:** Any plugin initialization failure crashes agent
- **Rationale:** Cannot run safely with broken critical plugins (especially auth/security)

**Extension Points:** Fixed 4 points for MVP (beforeLLMRequest, beforeToolCall, afterToolResult, beforeResponse)
- **Rationale:** Proven from PR #385, can add more later without breaking

**Path Resolution:** Support `{{dexto.agent_dir}}` template
- **Rationale:** Consistent with file prompt contributors, explicit not magic

**Priority Ordering:** Lower number = runs first
- **Rationale:** Matches Dexto's system prompt contributor convention; critical plugins (auth) get low numbers

**Local Files Only (MVP):** No npm package support initially
- **Rationale:** Simpler implementation, covers 90% of use cases, can add later

**Built-In Plugin Registry:** Central registry function auto-registers built-ins based on config
- **Rationale:** Follows PR #385 hooks pattern; simpler user config (reference by name); no file paths needed for built-ins

**Absolute Paths Only:** Reject relative paths, require absolute after template expansion
- **Rationale:** Eliminates runtime working directory ambiguity; explicit configuration; matches system prompt file contributor pattern

**Runtime Plugin Validation:** Validate plugin shape (class, methods exist) at load time
- **Rationale:** Fail fast with clear errors; prevent runtime surprises; complement TypeScript compile-time checks

**AsyncLocalStorage for Multi-Tenant:** Store tenantId/userId in AsyncLocalStorage context (Node.js)
- **Rationale:** Automatic context propagation; no API changes; clean separation; zero overhead when unused
- **TODO:** Add fallback for non-Node.js environments (browsers, edge workers)

---

## Multi-Process Clarification

**Scenario:** Multiple Node.js processes (PM2, cluster mode) behind load balancer

**Behavior:**
- Each process loads plugins independently
- Plugin state is per-process (not shared across processes)
- Plugins needing shared state use storage backends (automatically shared)
- Most deployments are single-process (this is fine for MVP)

**Example:** In-memory rate limiting in a plugin would be per-process. For shared rate limiting across processes, plugin must use storage backend.

---

## Security & Plugin Safety

### No Sandboxing in MVP

**Reality:** Plugins have full access to the Node.js process
- Can read/write files
- Can make network requests
- Can access all agent services
- Can crash the agent
- No isolation between plugins

**Mitigation Strategies:**
1. **Timeout Enforcement:** Prevents infinite loops (5 second default)
2. **Error Handling:** Non-blocking plugins don't crash agent on runtime errors
3. **Code Review:** Document that plugins should be treated as trusted code
4. **Logging:** All plugin executions logged for observability

**Documentation Warning:**
> **⚠️ Security Notice:** Plugins run with full access to the Node.js process and all agent services. Only install plugins from trusted sources. Review plugin code before deployment, especially in multi-tenant environments.

**Future Considerations:**
- Worker thread isolation (performance overhead)
- VM sandboxing (limited security benefits in Node.js)
- Permission system (read-only vs read-write access)

---

## References

- **PR #385:** Initial hooks implementation (to be replaced)
- **OpenSearch Plugin System:** Research analysis in `/tmp/` (design patterns borrowed)
- **Dexto Architecture Docs:** `CLAUDE.md` for general conventions
- **System Prompt Contributors:** Priority convention reference (lower = earlier)

---

**End of Specification**
