# Project-Based Architecture: Two-Tier Design for Dexto

## Executive Summary

Dexto should support two distinct usage patterns:
1. **Simple Mode**: Run standalone YAML files anywhere (like running an HTML file)
2. **Project Mode**: Opinionated project structure with TypeScript, build system, and custom code (like Next.js)

This provides a **progressive complexity model** - users start simple and upgrade to projects when they need custom code.

**Architecture Advantage:** Dexto's existing Hono-based server (`@dexto/server`) already provides the perfect foundation. The bundled output directly integrates with `createNodeServer()` and `createDextoApp()`, significantly reducing implementation complexity.

---

## The Problem

**Current limitation:** Custom plugins in YAML files have poor DX:
- No TypeScript autocomplete
- Runtime compilation with `tsx`
- Per-file dependency management
- No build-time validation
- Hard to share code between plugins

**User pain point:** "I can point to a TypeScript file, but I have no type safety and the DX is terrible."

---

## The Solution: Two-Tier Architecture

### Tier 1: Simple Mode (No Project Required)

**Use case:** Quick prototypes, learning, simple agents, demos

**Workflow:**
```bash
# Create a YAML file anywhere
cat > agent.yml << EOF
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: \$OPENAI_API_KEY

systemPrompt: You are helpful
EOF

# Run it
dexto run agent.yml
```

**Characteristics:**
- ✅ Single YAML file
- ✅ No project structure needed
- ✅ No dependencies
- ✅ Built-in plugins only
- ✅ Standard MCP servers
- ✅ Works from any directory
- ❌ No custom code

**Mental model:** Like opening an HTML file in a browser - it just works.

---

### Tier 2: Project Mode (Opinionated Structure)

**Use case:** Production apps, custom plugins/tools, team projects, complex logic

**Workflow:**
```bash
# Initialize project
dexto init my-project
cd my-project

# Project structure created:
# my-project/
#   dexto.config.ts
#   package.json
#   agents/
#     customer-support.yml
#     data-analyst.yml
#   plugins/
#     analytics.ts
#     rate-limiter.ts
#   tools/
#     custom-search.ts
#   shared/
#     utils.ts

# Install dependencies
npm install

# Development mode (hot reload, TypeScript)
dexto dev

# Build for production
dexto build

# Run production bundle
dexto start customer-support
```

**Characteristics:**
- ✅ Full TypeScript support
- ✅ Build-time validation
- ✅ Shared dependencies
- ✅ Custom plugins/tools
- ✅ Hot reload in dev
- ✅ Production bundling
- ✅ Proper tooling

**Mental model:** Like Next.js - opinionated structure, great DX, production-ready.

---

## Project Structure Conventions

### Directory Layout

```
my-dexto-project/
  ├── dexto.config.ts      # Project configuration
  ├── package.json          # Dependencies
  ├── tsconfig.json         # TypeScript settings
  ├── .env                  # Environment variables
  │
  ├── agents/               # Agent definitions (YAML)
  │   ├── customer-support.yml
  │   ├── data-analyst.yml
  │   └── code-reviewer.yml
  │
  ├── plugins/              # Custom plugins (TypeScript)
  │   ├── analytics.ts
  │   ├── rate-limiter.ts
  │   └── tenant-auth.ts
  │
  ├── tools/                # Custom tools (TypeScript)
  │   ├── custom-search.ts
  │   └── database-query.ts
  │
  ├── shared/               # Shared utilities
  │   ├── utils.ts
  │   └── constants.ts
  │
  └── dist/                 # Build output (generated)
      ├── agents.js
      └── agents.js.map
```

### Convention-Based Discovery

**Plugins:** Files in `plugins/` are auto-discovered by name

```
plugins/analytics.ts → referenced as 'analytics'
plugins/rate-limiter.ts → referenced as 'rate-limiter'
```

**Agent YAML references plugins by name:**
```yaml
# agents/customer-support.yml
plugins:
  custom:
    - analytics        # ← Finds plugins/analytics.ts
    - rate-limiter
```

**Tools:** Files in `tools/` are auto-registered

```
tools/custom-search.ts → tool name: 'custom_search'
```

---

## Configuration File

### `dexto.config.ts`

```typescript
import { defineConfig } from '@dexto/core';

export default defineConfig({
  // Project metadata
  name: 'my-dexto-project',
  version: '1.0.0',

  // Auto-discovery
  agents: {
    dir: './agents',           // Where agent YAMLs live
    include: ['*.yml', '*.yaml'],
  },

  plugins: {
    dir: './plugins',          // Where custom plugins live
    include: ['*.ts', '*.js'],
  },

  tools: {
    dir: './tools',            // Where custom tools live
    include: ['*.ts', '*.js'],
  },

  // Build settings
  build: {
    outDir: './dist',
    bundle: true,              // Bundle all code into single file
    minify: true,              // Minify for production
    sourcemap: true,           // Generate source maps
    target: 'node18',          // Target runtime
    treeshake: true,           // Remove unused code
  },

  // Development settings
  dev: {
    port: 3000,
    watch: true,               // Hot reload
    logLevel: 'debug',
  },
});
```

---

## Plugin Development with Full Types

### Plugin Template

```typescript
// plugins/analytics.ts
import { definePlugin } from '@dexto/core';
import type {
  BeforeLLMRequestPayload,
  BeforeResponsePayload,
  PluginExecutionContext
} from '@dexto/core';

export default definePlugin({
  name: 'analytics',

  async beforeLLMRequest(
    payload: BeforeLLMRequestPayload,    // ← Full autocomplete!
    context: PluginExecutionContext       // ← Full autocomplete!
  ) {
    // Access typed context
    context.logger.info('LLM request', {
      userId: context.userId,
      sessionId: context.sessionId,
      text: payload.text,
    });

    // Track analytics
    await trackEvent('llm.request', {
      text: payload.text,
      user: context.userId,
    });

    return { ok: true };
  },

  async beforeResponse(
    payload: BeforeResponsePayload,
    context: PluginExecutionContext
  ) {
    // Track response
    await trackEvent('llm.response', {
      content: payload.content,
      model: payload.model,
      tokenUsage: payload.tokenUsage,
    });

    return { ok: true };
  },
});
```

**Benefits:**
- ✅ Full TypeScript autocomplete
- ✅ Compile-time type checking
- ✅ Can import from `node_modules`
- ✅ Can import from `shared/`
- ✅ Proper error messages

### Custom Tool with Types

```typescript
// tools/custom-search.ts
import { defineTool } from '@dexto/core';
import { z } from 'zod';
import { searchDatabase } from '../shared/utils.js';

export default defineTool({
  name: 'custom_search',
  description: 'Search our internal knowledge base',

  parameters: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().default(10).describe('Max results to return'),
    category: z.enum(['docs', 'code', 'support']).optional(),
  }),

  async execute({ query, maxResults, category }) {
    // Full type inference on parameters!
    const results = await searchDatabase({
      query,
      limit: maxResults,
      category,
    });

    return {
      results: results.map(r => ({
        title: r.title,
        content: r.excerpt,
        url: r.url,
      })),
    };
  },
});
```

---

## Build Process

### `dexto build`

**What it does:**
1. Discovers all agents from `agents/`
2. Discovers all plugins from `plugins/`
3. Discovers all tools from `tools/`
4. Resolves dependencies
5. Bundles with esbuild/tsup
6. Validates all code
7. Generates optimized output

**Output:**
```bash
$ dexto build

Building Dexto project...

Discovering resources:
  ✓ Found 3 agents: customer-support, data-analyst, code-reviewer
  ✓ Found 3 plugins: analytics, rate-limiter, tenant-auth
  ✓ Found 2 tools: custom-search, database-query

Compiling TypeScript:
  ✓ plugins/analytics.ts
  ✓ plugins/rate-limiter.ts
  ✓ plugins/tenant-auth.ts
  ✓ tools/custom-search.ts
  ✓ tools/database-query.ts

Validating:
  ✓ All plugins implement required interfaces
  ✓ All tools have valid schemas
  ✓ All agent configs are valid

Bundling:
  ✓ dist/agents.js (234 KB)
  ✓ dist/agents.js.map

Build complete in 1.4s
```

### Generated Bundle Structure

```typescript
// dist/agents.js (simplified)
import { AnalyticsPlugin } from './compiled-plugins.js';
import { RateLimiterPlugin } from './compiled-plugins.js';
import { CustomSearchTool } from './compiled-tools.js';

export const agentRegistry = {
  'customer-support': {
    config: {
      llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY },
      systemPrompt: 'You are a helpful customer support agent',
      // ... rest of config from YAML
    },
    plugins: [
      new AnalyticsPlugin(),
      new RateLimiterPlugin(),
    ],
    tools: [
      CustomSearchTool,
    ],
  },
  'data-analyst': {
    // ... agent definition
  },
};

// Helper to load agent
export async function loadAgent(name: string) {
  const agentDef = agentRegistry[name];
  if (!agentDef) throw new Error(`Agent '${name}' not found`);

  const agent = new DextoAgent(agentDef.config);

  // Register plugins
  for (const plugin of agentDef.plugins) {
    agent.registerPlugin(plugin);
  }

  // Register tools
  for (const tool of agentDef.tools) {
    agent.registerTool(tool);
  }

  return agent;
}
```

---

## Server Integration

### Existing Hono Architecture

**Current state:** Dexto's `@dexto/server` package already uses Hono and provides:

**Exports:**
- `createDextoApp()` → Returns `OpenAPIHono` app (framework-agnostic)
- `createNodeServer()` → Wraps Hono app with Node.js HTTP server + WebSocket support

**Routes already implemented:**
```
/health                    - Health checks
/.well-known/:agentId/     - A2A protocol
/api/greeting              - Agent greeting
/api/messages              - Send messages (POST)
/api/llm/switch            - Switch LLM provider
/api/sessions              - Session management
/api/mcp/*                 - MCP server management
/api/webhooks              - Webhook registration
/api/prompts               - Prompt management
/api/resources             - Resource access
/api/memory                - Memory operations
/api/agents/*              - Multi-agent management
/openapi.json              - OpenAPI spec
```

**WebSocket:** Already handles real-time agent events

### Build Output Integration

**The bundled output runs the existing server:**

```typescript
// .dexto/output/index.mjs (generated by dexto build)
import { createDextoApp, createNodeServer } from '@dexto/server';
import { agentRegistry } from './agents.mjs';

// Load agent from bundled registry
const activeAgentId = process.env.DEXTO_AGENT_ID || 'customer-support';
const agent = await agentRegistry[activeAgentId].load();

// Use existing server infrastructure
const app = createDextoApp({
  getAgent: () => agent,
  getAgentCard: () => agent.getAgentCard(),
  // Multi-agent context if needed
  agentsContext: {
    switchAgentById: async (id) => { /* ... */ },
    // ...
  }
});

// Create Node.js server with WebSocket
createNodeServer(app, {
  getAgent: () => agent,
  port: process.env.PORT || 3001,
  hostname: '0.0.0.0',
  websocketPath: '/',
});
```

### Development Mode Additions

**Minimal server changes needed for `dexto dev`:**

1. **Hot reload SSE endpoint** (already have WebSocket, add SSE for browser refresh):
```typescript
// Add to createDextoApp() when DEXTO_DEV=true
if (process.env.DEXTO_DEV === 'true') {
  app.get('/__refresh', (c) => {
    // SSE stream for hot reload notifications
    return c.streamSSE(/* ... */);
  });

  app.get('/__hot-reload-status', (c) => {
    return c.json({ enabled: !agent.isProcessing() });
  });
}
```

2. **Playground UI serving** (optional - for integrated UI):
```typescript
// Serve WebUI at root in dev mode
if (process.env.DEXTO_DEV === 'true') {
  app.get('/*', serveStatic({ root: './webui-dist' }));
}
```

**That's it!** The rest of the server infrastructure already exists.

### Deployment Flow

```
┌─────────────────────────────────────────────────────┐
│ Project Structure                                    │
├─────────────────────────────────────────────────────┤
│ agents/                                              │
│   └── customer-support.yml                          │
│ plugins/                                             │
│   └── analytics.ts                                  │
│ tools/                                               │
│   └── database.ts                                   │
└──────────────────────────────────┬──────────────────┘
                                   │
                    dexto dev      │  dexto build
                         ├─────────┼─────────┐
                         ▼         │         ▼
         ┌─────────────────────┐  │  ┌──────────────────┐
         │ Development Mode    │  │  │ Production Build │
         ├─────────────────────┤  │  ├──────────────────┤
         │ • Watch + bundle    │  │  │ .dexto/output/   │
         │ • tsx runtime       │  │  │ ├─ index.mjs     │
         │ • createNodeServer()│  │  │ ├─ agents.mjs    │
         │ • Hot reload SSE    │  │  │ ├─ plugins.mjs   │
         │ • WebSocket events  │  │  │ ├─ package.json  │
         └─────────────────────┘  │  │ └─ node_modules/ │
                                  │  └────────┬─────────┘
                                  │           │
                                  │      node index.mjs
                                  │           │
                                  │           ▼
         ┌────────────────────────┴─────────────────────┐
         │         Uses createNodeServer()              │
         │  • REST API on port 3001                     │
         │  • WebSocket on same server                  │
         │  • All existing routes                       │
         │  • OpenTelemetry (optional)                  │
         └──────────────────────────────────────────────┘
```

**Key insight:** Build output is just a specialized entry point that calls the existing server functions. No server refactoring needed.

---

## Development Mode

### `dexto dev`

**What it does:**
1. Starts development server
2. Compiles TypeScript with `tsx`
3. Watches for file changes
4. Hot reloads on changes
5. Provides detailed error messages

**Example session:**
```bash
$ dexto dev

Starting Dexto development server...

✓ Loaded project config from dexto.config.ts
✓ Discovered 3 agents
✓ Compiled 3 plugins
✓ Registered 2 tools

Development server running:
  ➜ Local:    http://localhost:3000
  ➜ Agents:   customer-support, data-analyst, code-reviewer

Watching for changes...

[20:15:32] File changed: plugins/analytics.ts
[20:15:32] Recompiling...
[20:15:32] ✓ Hot reload complete in 234ms
```

---

## CLI Commands

### Simple Mode Commands

```bash
# Run standalone YAML
dexto run agent.yml

# Start API server
dexto serve agent.yml --port 3000

# Validate YAML
dexto validate agent.yml
```

### Project Mode Commands

```bash
# Initialize new project
dexto init <project-name>
dexto init my-project --template typescript

# Development
dexto dev                    # Start dev server (default: all agents)
dexto dev customer-support   # Start specific agent

# Build
dexto build                  # Build all agents
dexto build --minify         # Minify output
dexto build --sourcemap      # Generate sourcemaps

# Production
dexto start customer-support # Start built agent
dexto start --all            # Start all agents

# Utilities
dexto list                   # List all agents
dexto validate               # Validate all agents/plugins
dexto generate plugin <name> # Generate plugin template
dexto generate tool <name>   # Generate tool template
```

---

## Migration Path

### For Existing Simple YAML Users

**No change required.** Continue using `dexto run agent.yml`.

### For Users Wanting Custom Code

**Option 1: Minimal (Add plugins to existing YAML)**

Current approach still works (for now):
```yaml
plugins:
  custom:
    - name: analytics
      module: ./plugins/analytics.ts
```

But you get better DX with a project.

**Option 2: Migrate to Project**

```bash
# 1. Initialize project in current directory
dexto init . --from-yaml agent.yml

# This creates:
# - dexto.config.ts
# - package.json
# - agents/agent.yml (moved)
# - plugins/ (empty, ready for custom plugins)

# 2. Move custom plugins to plugins/ folder
mv plugins/analytics.ts plugins/

# 3. Update YAML to reference by name
# Old: module: ./plugins/analytics.ts
# New: - analytics

# 4. Install dependencies
npm install

# 5. Use project mode
dexto dev
```

---

## Comparison with Frameworks

### Next.js

**Simple:** HTML file
```html
<html>
  <body>Hello World</body>
</html>
```

**Project:**
```
my-next-app/
  pages/
  components/
  package.json
```

### Dexto

**Simple:** YAML file
```yaml
llm: { provider: openai }
systemPrompt: You are helpful
```

**Project:**
```
my-dexto-project/
  agents/
  plugins/
  package.json
```

Same mental model, same progressive complexity.

---

## Implementation Phases (Revised)

### Complexity Assessment

**Overall Difficulty:** 6/10 (Moderate)
**Total Timeline:** 5-7 weeks

**Why reduced from initial estimate:**
- ✅ Server architecture already complete (Hono + WebSocket)
- ✅ OpenAPI integration working
- ✅ WebSocket event system in place
- 🔨 Only need: Bundler + CLI commands + convention discovery

**Hardest parts:**
1. Build system with Rollup + esbuild (2-3 weeks)
2. Hot reload development mode (1 week)
3. Convention-based discovery (1 week)

---

### Phase 1: Project Initialization (1 week)

**Goal:** Allow users to create projects

**Tasks:**
- [ ] Implement `dexto init` command
- [ ] Create project template with agents/, plugins/, tools/
- [ ] Generate `dexto.config.ts` schema
- [ ] Scaffold directory structure
- [ ] Generate `package.json` with dependencies
- [ ] Add `tsconfig.json` for TypeScript
- [ ] Create example agent YAML
- [ ] Create example plugin with types

**Deliverables:**
- `dexto init <name>` creates complete project structure
- `dexto init .` initializes in existing directory
- Working TypeScript configuration
- Example files demonstrate patterns

**Technical details:**
- Use template directory in CLI package
- Copy files with variable substitution (project name, etc.)
- Validate project name
- Check for existing files/conflicts
- Install dependencies automatically (optional)

---

### Phase 2: Convention-Based Discovery (1 week)

**Goal:** Auto-discover plugins/tools from folders

**Tasks:**
- [ ] Plugin discovery from `plugins/` folder
- [ ] Tool discovery from `tools/` folder
- [ ] Name mapping convention (file name → plugin name)
  - `plugins/analytics.ts` → `'analytics'`
  - `plugins/rate-limiter.ts` → `'rate-limiter'`
- [ ] Validation of discovered resources
  - Check exports (`export default definePlugin(...)`)
  - Validate plugin interface implementation
- [ ] Update YAML parsing to resolve names to file paths
- [ ] Error messages for missing/invalid plugins

**Deliverables:**
- Plugins referenced by name in YAML work automatically
- Clear error messages when plugins not found
- Auto-discovery documented

**Technical details:**
- Use glob patterns to find files: `plugins/**/*.{ts,js}`
- Exclude test files: `**/*.{test,spec}.{ts,js}`
- Build plugin registry: `Map<string, string>` (name → file path)
- Validate exports at discovery time
- Cache discovery results for performance

---

### Phase 3: Build System (2-3 weeks) ⚠️ HARDEST

**Goal:** Production-ready bundling with Rollup + esbuild

**Tasks:**
- [ ] Set up Rollup with esbuild plugin
- [ ] Implement dependency analysis
  - Detect workspace packages
  - Separate bundled vs external deps
  - Handle Node.js built-ins
- [ ] Bundle agent configs
  - Parse YAML files
  - Convert to JavaScript registry
- [ ] Bundle plugins separately
  - Each plugin as separate module
  - Combine into `plugins.mjs`
- [ ] Bundle tools separately
  - Auto-discover and bundle
  - Generate tool registry
- [ ] Generate entry point (`index.mjs`)
  - Import `createDextoApp` and `createNodeServer`
  - Load agent from registry
  - Start server
- [ ] Generate `package.json` for output
  - Only production dependencies
  - Correct versions from workspace
- [ ] Install dependencies in output dir
- [ ] Tree-shaking and minification
- [ ] Source map generation

**Deliverables:**
- `dexto build` creates `.dexto/output/` directory
- Output is ready to run with `node index.mjs`
- Optimized bundle with tree-shaking
- Source maps for debugging

**Technical details:**
- Study Mastra's bundler implementation (`packages/deployer/src/bundler/`)
- Use Rollup for better library bundling than webpack
- esbuild plugin for fast TS compilation
- Virtual entry points for different output files
- Dependency graph analysis (see Mastra's `analyze.ts`)
- Handle circular dependencies gracefully

**Reference files from Mastra:**
- `/Users/karaj/Projects/mastra/packages/deployer/src/bundler/index.ts`
- `/Users/karaj/Projects/mastra/packages/deployer/src/build/analyze.ts`
- `/Users/karaj/Projects/mastra/packages/cli/src/commands/build/BuildBundler.ts`

---

### Phase 4: Development Mode (1 week)

**Goal:** Hot reload development server

**Tasks:**
- [ ] Implement `dexto dev` command
- [ ] Set up Rollup watch mode
- [ ] File change detection
- [ ] Trigger rebuild on changes
- [ ] Add SSE endpoint for hot reload (`/__refresh`)
- [ ] Add status endpoint (`/__hot-reload-status`)
- [ ] Integrate with existing `createNodeServer()`
- [ ] Start server with `DEXTO_DEV=true`
- [ ] Check if agent is processing before reload
- [ ] Better error messages with TypeScript info

**Deliverables:**
- `dexto dev` starts development server
- File changes trigger automatic reload
- Clear console output showing what changed
- Full TypeScript support with tsx

**Technical details:**
- Rollup has built-in watch mode
- SSE for browser notification (Hono supports SSE)
- Check agent state before hot reload (don't interrupt mid-conversation)
- Use tsx for runtime TS compilation in dev
- Production uses bundled output (no tsx)

**Server changes needed:**
Add to `packages/server/src/hono/index.ts`:
```typescript
if (process.env.DEXTO_DEV === 'true') {
  app.get('/__refresh', (c) => c.streamSSE(...));
  app.get('/__hot-reload-status', (c) => c.json({ enabled: !agent.isProcessing() }));
}
```

---

### Phase 5: Helper Functions & Types (1 week)

**Goal:** Best-in-class TypeScript DX

**Tasks:**
- [ ] Create `definePlugin()` helper
  - Type-safe plugin definition
  - Validates structure at build time
- [ ] Create `defineTool()` helper
  - Type-safe tool definition
  - Integrates with Zod schemas
- [ ] Create `defineConfig()` helper for `dexto.config.ts`
- [ ] Export all plugin types from `@dexto/core`
  - `BeforeLLMRequestPayload`
  - `BeforeResponsePayload`
  - `PluginExecutionContext`
  - All other plugin-related types
- [ ] Template generators
  - `dexto generate plugin <name>`
  - `dexto generate tool <name>`
- [ ] Documentation with examples
  - Plugin development guide
  - Tool development guide
  - Type reference

**Deliverables:**
- Full autocomplete in VSCode/editors
- Type errors caught at build time
- Template generators for quick starts
- Comprehensive documentation

**Technical details:**
```typescript
// Helpers should provide type inference
export function definePlugin<TConfig = unknown>(
  plugin: PluginDefinition<TConfig>
): PluginDefinition<TConfig> {
  return plugin; // Identity function for type inference
}
```

---

### Phase 6: Production Features (1 week)

**Goal:** Production deployment support

**Tasks:**
- [ ] Implement `dexto start` command
  - Loads from `.dexto/output/index.mjs`
  - Sets `NODE_ENV=production`
  - Runs with `node` (no tsx)
- [ ] Environment variable management
  - `.env` file support
  - `.env.production` override
  - Validation of required vars
- [ ] `dexto list` command
  - List all agents in project
  - Show which is active
- [ ] `dexto validate` command
  - Validate all YAML files
  - Check plugin implementations
  - Dry-run build
- [ ] Docker support
  - Example Dockerfile
  - Multi-stage build
  - Minimal runtime image
- [ ] Documentation
  - Deployment guides
  - Environment management
  - Production best practices

**Deliverables:**
- `dexto start` runs production server
- Production deployment guides
- Docker example for containerization
- Environment validation

**Technical details:**
- `dexto start` is simple: `node .dexto/output/index.mjs`
- Environment loading via dotenv
- Validate required API keys before starting
- Health check endpoint already exists (`/health`)

**Future consideration (not in scope):**
- Serverless adapters (Vercel, AWS Lambda)
- Platform-specific deployers (like Mastra)
- These can be added later based on user demand

---

## Success Criteria

### For Simple Users
- [ ] Can run `dexto run agent.yml` from anywhere
- [ ] No project structure required
- [ ] Works exactly as it does today
- [ ] No breaking changes

### For Project Users
- [ ] Full TypeScript autocomplete in plugins
- [ ] Hot reload during development
- [ ] Build-time validation catches errors
- [ ] Production builds are optimized
- [ ] Clear documentation and templates
- [ ] Migration path from simple mode

### For Dexto
- [ ] No runtime TypeScript compilation in production
- [ ] Smaller bundle sizes (tree-shaking)
- [ ] Better error messages
- [ ] Easier to onboard new users (progressive complexity)
- [ ] Aligns with industry standards (Next.js model)

---

## Open Questions

### 1. Should projects bundle agents into single file or per-agent?

**Option A: Single bundle**
```
dist/agents.js  # All agents
```
- Shared code across agents
- Single deployment artifact

**Option B: Per-agent bundles**
```
dist/customer-support.js
dist/data-analyst.js
```
- Smaller bundles
- Independent deployment

**Recommendation:** Default to single bundle, allow per-agent with flag.

### 2. How do we handle shared dependencies between plugins?

**Option A: Dedupe in bundle**
```typescript
// plugins/plugin-a.ts
import { track } from 'analytics';

// plugins/plugin-b.ts
import { track } from 'analytics';

// Bundled: only one copy of 'analytics'
```

**Option B: Explicit shared folder**
```typescript
// shared/analytics.ts
export { track } from 'analytics';

// plugins/plugin-a.ts
import { track } from '../shared/analytics.js';
```

**Recommendation:** Both - deduping happens automatically, but shared/ is for user-written shared code.

### 3. Should `dexto dev` start all agents or just one?

**Option A: All agents**
```bash
dexto dev  # Starts all agents on different ports
```

**Option B: Specific agent**
```bash
dexto dev customer-support
```

**Recommendation:** Support both - default to all, allow specific with argument.

### 4. How do we version projects vs. CLI?

```json
{
  "name": "my-dexto-project",
  "version": "1.0.0",
  "dependencies": {
    "@dexto/core": "^2.0.0",
    "@dexto/cli": "^2.0.0"
  }
}
```

Projects depend on specific Dexto versions. Breaking changes in Dexto don't break old projects.

**Recommendation:** Standard semver, projects lock to specific versions.

---

## Documentation Outline

### Quick Start
1. Simple mode: Your first agent
2. Project mode: When to upgrade
3. Creating a project
4. Adding custom plugins
5. Building and deploying

### Guides
- Writing plugins with TypeScript
- Creating custom tools
- Sharing code between plugins
- Testing plugins
- Deploying to production
- Environment management
- CI/CD integration

### API Reference
- `dexto.config.ts` schema
- `definePlugin()` API
- `defineTool()` API
- Plugin lifecycle hooks
- Tool execution context

### Migration Guides
- Simple YAML to Project
- Updating existing plugins
- Breaking changes

---

## Timeline Summary

| Phase | Duration | Description | Difficulty |
|-------|----------|-------------|------------|
| Phase 1 | 1 week | Project initialization | Easy |
| Phase 2 | 1 week | Convention-based discovery | Medium |
| Phase 3 | 2-3 weeks | Build system (Rollup + esbuild) | **Hard** ⚠️ |
| Phase 4 | 1 week | Development mode with hot reload | Medium |
| Phase 5 | 1 week | Helper functions & types | Easy |
| Phase 6 | 1 week | Production features | Easy |

**Total: 5-7 weeks (reduced from initial 9 weeks)**

**Why faster:** Existing Hono server architecture eliminates 2+ weeks of server development work.

---

## Comparison: Mastra vs. Dexto Architecture

### Server Infrastructure

| Aspect | Mastra | Dexto | Status |
|--------|---------|-------|--------|
| Web framework | Hono | Hono (OpenAPIHono) | ✅ Same |
| Node.js bridge | `createNodeServer()` | `createNodeServer()` | ✅ Same |
| WebSocket | SSE for hot reload | WebSocket for agent events | ✅ Already better |
| OpenAPI | Integrated | Integrated with `@hono/zod-openapi` | ✅ Same |
| Routes | `/api/*` pattern | `/api/*` pattern | ✅ Same |
| Playground | Vite SPA | Next.js app | ⚠️ Different (see below) |

**Key insight:** Dexto's server architecture is already at parity with Mastra. The work is in the build system and CLI commands, not the server.

### WebUI Architecture

**Mastra:**
- Vite + React SPA (`packages/cli/src/ui/`)
- Served from dev server at root `/`
- Hot reload via SSE (`/__refresh` endpoint)
- Bundled into CLI package
- Lightweight, fast dev experience

**Dexto:**
- Next.js 14 App Router (`packages/webui/`)
- Separate development server
- Server-side rendering capabilities (not heavily used)
- More features but heavier

**Consideration for future:** Moving Dexto WebUI to Vite would:
- ✅ Align with Mastra's simpler architecture
- ✅ Faster dev server startup
- ✅ Lighter bundle size
- ✅ Easier to embed in CLI
- ❌ Lose SSR (but you're not using it much)
- ❌ Migration effort required

This is a separate decision from the project-based architecture.

### Build System

| Aspect | Mastra | Dexto (Current) | Dexto (Proposed) |
|--------|---------|-----------------|------------------|
| Bundler | Rollup + esbuild | tsx (runtime) | Rollup + esbuild |
| Dev mode | Watch + hot reload | tsx with manual restart | Watch + hot reload |
| Production | Pre-bundled | tsx runtime | Pre-bundled |
| Output | `.mastra/output/` | N/A | `.dexto/output/` |

**Key difference:** Mastra has full build/dev CLI commands, Dexto currently relies on runtime compilation.

---

## Conclusion

This two-tier architecture provides:

1. **Simple entry point** - YAML files work anywhere (no project needed)
2. **Progressive complexity** - Upgrade to project when you need custom code
3. **Best-in-class DX** - Full TypeScript, hot reload, build-time validation
4. **Production ready** - Optimized bundles, no runtime compilation
5. **Industry alignment** - Familiar pattern (Next.js, Vite, etc.)
6. **Leverages existing server** - Hono infrastructure already complete

**This solves the core problem:** Poor DX for custom plugins in YAML files, while maintaining simplicity for basic use cases.

**Implementation advantage:** With server architecture already in place, focus is on build system and CLI commands - a cleaner, more focused project.
