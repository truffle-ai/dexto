# Implementation Order: Core Migration Plans

**Purpose:** Defines the correct sequence for implementing all feature plans in this folder, based on dependencies, overlaps, and risk management.

**Last Updated:** 2025-01-06

## 📊 Current Progress Status

**Overall:** Phase 1 - 94% complete (Weeks 1-4 done + bonus work, Week 5 ~40% done)

### ✅ Completed Work (Weeks 1-4 + Bonus)
- ✅ Week 1: Path removal from all core services
- ✅ Week 2: CLI config enrichment layer
- ✅ Weeks 3-4: Multi-transport logger architecture
- ✅ Bonus #1: Dead code cleanup (removed agentId parameters)
- ✅ **Bonus #2: InMemoryBlobStore implementation (~400 LOC)**
- ✅ **Bonus #3: Schema standardization (fixed internalTools, unified patterns)**
- ✅ **Bonus #4: Storage schema defaults (in-memory defaults + CLI override)**
- ✅ **Bonus #5: Test fixes (17 failures → 0, all 1088 tests passing)**

### 🔄 Current Status (2025-01-06)
- **Active:** Phase 1, Week 5 - Dependency Injection (~40% complete)
- **Branch:** `refactors-4`
- **Recent Commits:**
  - `9918aea7` - test: add logger parameter to all test files
  - `7a89150c` - fix: resolve TypeScript errors from logger injection
  - `b400b183` - wip: inject logger into core services (Phase 2)
  - `a5884a1f` - feat(core): inject logger into SearchService and MemoryManager
  - `fa5a087f` - feat(logger): expose createChild and destroy in IDextoLogger interface
  - `80e4bbff` - refactor: add agentId to config schema, eliminate duplication
  - `d2257175` - feat(core): pass logger from DextoAgent to service-initializer
  - `ff04a804` - feat(core): inject logger into DextoAgent via constructor
  - `dd051190` - feat(core): add logger factory for dependency injection

### ⏭️ Next Steps
1. **Continue Week 5: Dependency Injection (~40% done, ~60% remaining)**
   - ✅ Created logger factory and injected into DextoAgent
   - ✅ Updated top-level managers (MCPManager, ToolManager, SessionManager, etc.)
   - ✅ Fixed all TypeScript errors and updated test files
   - ⏳ **NEXT:** Update remaining ~67 files in layers:
     - LLM layer (11 files: formatters, services, tokenizer)
     - Storage layer (9 files: blob/cache/database factories and stores)
     - Session/Context/Prompts/Resources (~15 files)
     - Core utilities (~13 files)
     - CLI/Server/Agent-Management (23 files)
   - Remove singleton logger pattern from exports
2. Remove remaining `getDextoPath()` fallbacks (if any)
3. Then proceed to Phase 2: Vite Migration (weeks 6-7.5)

---

**Last Updated (original):** 2025-01-05

---

## Executive Summary

**Total Timeline:** 14 weeks for all deliverable features

**Sequence:**
1. **Path + Logger Migration (COMBINED)** - 5 weeks - Foundation
2. **Vite Migration** - 1.5 weeks - Quick win
3. **HIL Handler + Project-Based (PARALLEL)** - 7 weeks - Advanced features
4. **SSE Migration** - DEFERRED (blocked on technical issues)

---

## Why This Order?

### Critical Dependencies

```
FOUNDATION (Must Be First):
┌─────────────────────────────────────────────┐
│ Path + Logger Migration (COMBINED)          │
│ - Removes getDextoPath() from all services  │
│ - Multi-transport logger architecture       │
│ - Dependency injection pattern              │
│ - Config enrichment layer                   │
│ Timeline: 5 weeks                            │
└──────────────┬──────────────────────────────┘
               │ Establishes:
               │ • DI pattern (inject, not singleton)
               │ • Config enrichment API
               │ • Per-agent path isolation
               ▼
        ┌──────┴────────┐
        │               │
    ┌───▼────┐     ┌───▼─────────────────┐
    │  Vite  │     │  HIL Handler        │
    │ (1.5w) │     │  Redesign (4w)      │
    └───┬────┘     └───┬─────────────────┘
        │              │ Uses DI pattern
        │              │ Handler registration
        │              │ Transport-agnostic
        │              └─────────┐
        │                        │
    ┌───▼────────────────────────▼───────┐
    │ Project-Based Architecture (7w)    │
    │ - Uses config enrichment API       │
    │ - Implements plugin instances      │
    │ - Convention-based discovery       │
    └────────────────────────────────────┘
```

### Key Insights

1. **Path + Logger MUST be combined**
   - Logger isolation requires per-agent paths
   - Both need the same config enrichment layer
   - Splitting them = redo work later
   - See: `migration.md` Phase 1 appears simple but requires full `logger-architecture-recommendations.md`

2. **DI Pattern established in Phase 1**
   - Logger injection becomes the template
   - HIL handler registration follows same pattern
   - Can't do HIL before establishing DI

3. **Config enrichment is shared infrastructure**
   - Path/Logger needs: per-agent path defaults
   - Project-Based needs: plugin discovery
   - Design once in Phase 1, reuse in Phase 3

4. **Plugin instances embedded in Project-Based**
   - `core-refactors.md` is guidance, not separate work
   - Project-Based Phase 5 implements plugin instance support
   - No separate implementation needed

5. **HIL + Project-Based can truly parallelize**
   - Zero file overlap (core/server vs cli/build)
   - Both depend on Phase 1 only
   - HIL finishes week 11, Project-Based continues to week 14

---

## Phase 1: Path + Logger Migration (COMBINED)

**Timeline:** Weeks 1-5 (5 weeks)
**Plans:** `migration.md` + `logger-architecture-recommendations.md`
**Complexity:** High (Foundation work)
**Risk:** Medium (Breaking changes, but clear scope)

### Why This Must Be First

- **Everything depends on it**: DI pattern, config enrichment, per-agent isolation
- **Can't be split**: Logger needs per-agent paths; path refactor needs logger refactor
- **Serverless compatibility**: Core becomes truly portable

### What Gets Built

**Week 1: Path Removal** ✅ COMPLETED
- [x] Remove `getDextoPath()` from all services except logger
- [x] Make `storage.database.path` required for SQLite
- [x] Make `storage.blob.storePath` required for local storage
- [x] Add validation errors for missing paths
- [x] Update all service tests
- [x] **BONUS:** Remove agentId dead code (storage-manager, factories, stores)
- **Key Files:** `storage-manager.ts`, `database/factory.ts`, `sqlite-store.ts`, `blob/factory.ts`, `local-blob-store.ts`
- **Commits:** `aebf9c1a`, `f29a819e`, `946d9a93`

**Week 2: Config Enrichment Layer** ✅ COMPLETED
- [x] Create `packages/cli/src/config/config-enrichment.ts`
- [x] Design `enrichAgentConfig(config, configPath)` API
- [x] Implement `deriveAgentId(config, configPath)` with priority logic:
  1. `agentCard.name` (sanitized for filesystem)
  2. Filename (without extension, skips generic names like 'agent', 'config')
  3. `'default-agent'` fallback
- [x] Per-agent path generation:
  - [x] `logs/{agentId}.log`
  - [x] `database/{agentId}.db`
  - [x] `blobs/{agentId}`
- [x] Environment-aware defaults via `getDextoPath()` from @dexto/agent-management
- [x] Enrichment strategy:
  - **No storage in YAML** → CLI provides filesystem-based storage
  - **Partial storage** → Enriches empty paths only (SQLite path, local blob storePath)
  - **Explicit configs** → Respects user choices (doesn't override)
- [x] Comprehensive unit tests (14 test cases):
  - Agent ID derivation with all priority levels
  - Storage enrichment scenarios (missing, partial, full)
  - Logger enrichment (file transport addition)
  - Path generation with getDextoPath integration
  - Config immutability guarantees
- **Key Files:** `cli/src/config/config-enrichment.ts`, `config-enrichment.test.ts`
- **Commits:**
  - `f40cad12` - feat(cli): implement config enrichment layer
  - `d5282cb2` - fix: make storage required in schema and always provided by enrichment
  - `1e8fde5e` - fix: handle undefined storage fields safely in enrichment
- **Note:** Guardrails implemented - enrichment preserves user-specified values

**Weeks 3-4: Multi-Transport Logger** ✅ COMPLETED (95%)
- [x] Create logger transport interfaces (`LoggerTransport` type)
- [x] Create `BaseTransport` abstract class
- [x] Implement `FileTransport` (with rotation; default `maxSize=10MB`, `maxFiles=5`)
- [x] Implement `ConsoleTransport` (with colors via chalk)
- [ ] Implement `UpstashTransport` (OPTIONAL - deferred, not needed yet)
- [x] Create `DextoLogger` class with multi-transport support
- [x] Add structured logging (context objects, metadata)
- [x] Add `DextoLogComponent` enum for component-based filtering
- [x] Integrate logger config into `AgentConfigSchema`
- [x] CLI enrichment adds file transport automatically
- **Key Files:** `logger/v2/dexto-logger.ts`, `transports/*.ts`, `schemas.ts`
- **Commits:** `acb6ca80`, `e8df8a9e`, `12e8e093`

**Bonus Work (2024-12-06): InMemoryBlobStore + Schema Fixes** ✅ COMPLETED
- [x] **InMemoryBlobStore implementation** (~400 LOC)
  - Content-based deduplication using SHA-256 hashing
  - Configurable size limits (10MB per blob, 100MB total by default)
  - Multi-format retrieval: base64, buffer, stream, data URIs
  - MIME type detection via magic numbers and file extensions
  - Automatic cleanup of old blobs
  - No filesystem coupling (perfect for dev/test environments)
- [x] **Storage schema defaults**
  - Storage now defaults to full in-memory configuration
  - Clean separation: in-memory for dev, filesystem for prod
  - CLI enrichment provides production-ready storage
- [x] **Schema standardization**
  - Fixed `internalTools` to have `.default([])` (was missing modifier)
  - Unified method chaining: `.describe().optional()` or `.describe().default()`
  - Organized fields into semantic categories (required, optional, defaults)
  - Self-documenting code structure
- [x] **Test fixes**
  - Fixed 17 failing storage schema tests (added blob config)
  - Fixed env tests (mocked @dexto/agent-management)
  - Updated agent schema tests
  - All 1088 unit tests passing
- **Key Files:**
  - `core/src/storage/blob/memory-blob-store.ts`
  - `core/src/storage/blob/factory.ts`
  - `core/src/agent/schemas.ts`
  - `cli/src/config/config-enrichment.ts`
- **Commits:**
  - `2869725b` - feat: implement InMemoryBlobStore and set as schema default
  - `94bdd339` - refactor: standardize AgentConfigSchema field definitions
  - `b35e2408` - fix: add storage to validAgentConfig test helper
  - `6e395fa0` - fix: mock @dexto/agent-management in env tests
- **Memory Usage Analysis:**
  - Typical file prompts: ~50 KB
  - With custom prompt attachments: ~2.5 MB
  - With moderate image use: ~22 MB
  - Limit approached at ~85 MB (40+ large images)
- **Quality Checks:** All passing ✅
  - ✅ Build passed
  - ✅ Tests passed (1088/1088)
  - ✅ Lint passed
  - ✅ Typecheck passed

**Week 5: Dependency Injection** 🔄 IN PROGRESS (~40% complete)
- [x] Create logger factory (`createLogger()`) that bridges config to DextoLogger
- [x] Update DextoAgent to create and store logger instance
- [x] Pass logger from DextoAgent to `service-initializer`
- [x] Inject logger into top-level managers (~15 files):
  - MCPManager, ToolManager, SystemPromptManager, SessionManager
  - PluginManager, MemoryManager, ApprovalManager, SearchService
  - FilesystemService, ProcessService, ResourceManager, PromptManager
- [x] Fix all TypeScript compilation errors
- [x] Update all test files with mockLogger (100+ constructor calls)
- [ ] **IN PROGRESS:** Replace global `logger` imports with injected logger
  - [ ] LLM layer (11 files: formatters, services, tokenizer, registry, validation)
  - [ ] Storage layer (9 files: blob/cache/database factories and stores)
  - [ ] Session/Context/Prompts/Resources (~15 files)
  - [ ] Core utilities (~13 files: approval providers, config, filesystem, telemetry, etc.)
  - [ ] CLI/Server/Agent-Management packages (23 files)
- [ ] Remove singleton logger pattern from `logger/index.ts` exports
- [ ] Remove remaining `getDextoPath()` fallbacks (if any)
- **Estimated Effort:** 12-16 hours (6-8 hours completed, 6-8 hours remaining)
- **Key Challenge:** Touching many files, requires careful testing
- **Status:** Top-level services complete, remaining work is updating lower-level utilities

### Success Criteria

- [x] No `getDextoPath()` imports in `@dexto/core` (only in utils/path.ts definition)
- [x] All services accept explicit paths via config
- [x] Logger fully configurable with transports
- [x] CLI enriches config with per-agent defaults
- [ ] DI pattern established throughout codebase (Week 5 - PENDING)

### Deliverables

- [x] **Serverless-compatible core** - Core no longer assumes filesystem access
- [x] **Per-agent isolation** - All file-based resources isolated by agentId
- [x] **Multi-transport logging** - File, console (remote deferred)
- [ ] **Dependency injection pattern** - Week 5 pending
- [x] **Config enrichment API** - Ready for project-based architecture reuse

### Additional Notes

**Conditional Service Initialization (Added):**
- Added TODO in `service-initializer.ts` for lazy initialization of FileSystemService and ProcessService
- These services should only initialize when their dependent tools are enabled
- Current behavior: Always initialized for backward compatibility
- Future optimization: Check `config.internalTools` and conditionally initialize

**Backup Path Configuration:**
- FileSystemService backup paths remain unconfigured (separate from AgentConfig)
- Backups disabled by default (no `backupPath` provided)
- To enable: Would need filesystem config in AgentConfig schema + CLI enrichment

---

## Phase 2: Vite Migration

**Timeline:** Weeks 6-7.5 (1.5 weeks)
**Plan:** `webui-vite-migration.md`
**Complexity:** Moderate (Mechanical changes)
**Risk:** Low (Well-understood migration)

### Why After Phase 1

- **Cleaner server**: DI pattern already established when adding static serving
- **Simpler integration**: Logger already injected, no mixed patterns
- **Quick win**: Visible improvements after big refactor (morale boost)
- **Still independent**: Doesn't block other work

### What Gets Built

**Week 6: Vite Setup + Routing**
- Configure Vite with React plugin
- Migrate Next.js App Router → React Router
- Replace Next.js navigation components
- Update environment variables (`NEXT_PUBLIC_*` → `VITE_*`)

**Week 7: Components + Server Integration**
- Replace `next/image`, `next/head` with alternatives
- Add static file serving to Hono server
- Configure SPA fallback (all routes → index.html)
- Remove Next.js server spawning code from CLI
- Update build scripts

**Week 7.5: Polish + Testing**
- Test all routes and navigation
- Test WebSocket connections
- Performance testing (bundle size, load time)
- Update documentation

### Success Criteria

- [ ] All routes work with React Router
- [ ] Hono serves both API and UI on single port
- [ ] Bundle size <800KB gzipped
- [ ] Memory usage <60MB
- [ ] Startup time <1 second

### Deliverables

✅ Single-process deployment
✅ 60% memory reduction (130MB → 50MB)
✅ 6x faster startup (3s → 0.5s)
✅ Simpler architecture (one server, not two)

---

## Phase 3: HIL Handler + Project-Based (PARALLEL)

**Timeline:** Weeks 8-14 (7 weeks total, 4 weeks overlap)
**Plans:** `human-in-loop-handler-redesign.md` + `project-based-architecture.md`
**Complexity:** High (Build system is hard)
**Risk:** Medium (New patterns, complex tooling)

### Why These Can Be Parallel

- **Different packages**: HIL touches core/server, Project-Based is CLI/build
- **Zero file overlap**: No merge conflicts
- **Both depend on Phase 1**: DI pattern + config enrichment
- **HIL finishes early**: 4 weeks vs 7 weeks

### Timeline Breakdown

```
Week 8:  HIL ████ + Project-Based ████
Week 9:  HIL ████ + Project-Based ████
Week 10: HIL ████ + Project-Based ████
Week 11: HIL ████ + Project-Based ████
Week 12:             Project-Based ████
Week 13:             Project-Based ████
Week 14:             Project-Based ████
```

---

### 3A: HIL Handler Redesign (Weeks 8-11)

**What Gets Built:**

**Week 8: Core API**
- Add `ApprovalHandler` type
- Update `ApprovalManager` to use handler
- Add `agent.setApprovalHandler()` API
- Rename `event-based` → `manual` mode
- Startup validation (fail-fast in `agent.start()` if handler missing)

**Week 9: Handler Implementations**
- Create `createWebSocketApprovalHandler()`
- Adapt existing `EventBasedApprovalProvider` logic
- Test handler isolation

**Week 10: Server Integration**
- Wire approval handler in server bootstrap
- Update API endpoints if needed
- Test with real agent interactions

**Week 11: Testing + Documentation**
- Unit tests for handler registration
- Integration tests for WebSocket handler
- Update documentation and examples

**Success Criteria:**
- [ ] `agent.setApprovalHandler()` API works
- [ ] Manual mode requires handler (fail-fast at startup)
- [ ] WebSocket handler works identically to current behavior
- [ ] No silent hangs

**Deliverables:**
✅ Transport-agnostic approvals
✅ Explicit handler registration
✅ Fail-fast validation
✅ Foundation for future transports (if SSE ever happens)

---

### 3B: Project-Based Architecture (Weeks 8-14)

**What Gets Built:**

**Weeks 8-9: Initialization + Discovery**
- Implement `dexto init` command
- Create project template structure
- Convention-based plugin discovery (plugins/ → 'analytics')
- Convention-based tool discovery (tools/ → 'custom_search')
- Validation of discovered resources

**Weeks 10-12: Build System** ⚠️ **HARDEST PART**
- Set up Rollup with esbuild plugin
- Dependency analysis (workspace packages, external deps)
- Bundle agent configs (YAML → JS registry)
- Bundle plugins separately
- Bundle tools separately
- Generate entry point (`index.mjs`)
- Generate `package.json` for output
- Tree-shaking and minification
- Source map generation

**Week 13: Development Mode**
- Implement `dexto dev` command
- Rollup watch mode
- File change detection and rebuild
- Hot reload via SSE endpoint (`/__refresh`)
- Integration with existing `createNodeServer()`
- Better error messages with TypeScript info

**Week 14: Production Features + Polish**
- Implement `dexto start` command
- Environment variable management (.env files)
- `dexto list` and `dexto validate` commands
- Template generators (`dexto generate plugin/tool`)
- Documentation and examples

**Success Criteria:**
- [ ] `dexto init` creates complete project structure
- [ ] Convention-based discovery works automatically
- [ ] `dexto build` creates production-ready bundle
- [ ] `dexto dev` provides hot reload
- [ ] Full TypeScript autocomplete in plugins
- [ ] Plugin instance support implemented

**Deliverables:**
✅ TypeScript plugin development (full types, autocomplete)
✅ Build system with Rollup + esbuild
✅ Hot reload development mode
✅ Production-ready bundling
✅ Plugin instance support (from `core-refactors.md`)
✅ Convention-based discovery

---

## Phase 4: WebSocket to SSE Migration (DEFERRED)

**Timeline:** Would be weeks 15-22 (6-8 weeks)
**Plan:** `websocket-to-sse-migration.md`
**Status:** ⚠️ **DO NOT IMPLEMENT - BLOCKED**

### Why Deferred

The plan explicitly states "WORK IN PROGRESS - DO NOT IMPLEMENT YET" with several **unresolved blockers**:

1. **EventSource Auth Limitations**
   - Browser EventSource cannot send custom headers (e.g., `Authorization: Bearer`)
   - No clear solution for authentication yet

2. **Error Handling Strategy**
   - EventSource error events provide no context (no status codes, no error messages)
   - Need to design error event protocol from scratch

3. **Race Conditions**
   - What if EventSource isn't connected when events are emitted?
   - Event queuing/replay strategy not designed

4. **Reconnection Edge Cases**
   - Human-in-the-loop approvals during disconnect
   - Event ordering guarantees unclear

5. **Proxy Configuration**
   - nginx, Cloudflare buffer by default
   - Need concrete configuration examples

### Alternative: Keep WebSocket

- ✅ WebSocket works reliably
- ✅ Modern platforms support WebSocket (Vercel, Cloudflare, etc.)
- ✅ No auth issues
- ✅ Better error context
- ✅ No race conditions

### When to Reconsider

Only implement SSE if:
- Technical blockers are resolved with concrete solutions
- Strong user demand emerges for HTTP-only architecture
- Serverless constraints require it (unlikely - most support WebSocket now)

---

## Visual Timeline

```
Week 1-5:   ██████████████████████ Path + Logger (Foundation)
            └─→ DI, serverless core, config enrichment

Week 6-7.5: ███████ Vite (Quick Win)
            └─→ Single process, -60% memory, 6x faster

Week 8-11:  ████████████ HIL Handler
            └─→ Transport-agnostic approvals

Week 8-14:  ████████████████████ Project-Based
            └─→ TypeScript plugins, build system
            (Weeks 8-11 overlap with HIL)

SKIP:       WebSocket to SSE (blocked on technical issues)
```

**Total: 14 weeks for all deliverable features**

---

## What You Get After 14 Weeks

### Foundation Improvements
✅ Serverless-compatible core (no file-based defaults)
✅ Per-agent isolation (logs, storage, everything)
✅ Multi-transport logging (file, console, upstash)
✅ Dependency injection pattern throughout codebase
✅ Config enrichment API (CLI layer)

### Deployment Improvements
✅ Single-process deployment (Vite)
✅ 60% memory reduction (130MB → 50MB)
✅ 6x faster startup (3s → 0.5s)
✅ Simpler architecture (one server, not two)

### Developer Experience Improvements
✅ Transport-agnostic approvals (pluggable handlers)
✅ TypeScript plugin development (full types, autocomplete)
✅ Build system (Rollup + esbuild, tree-shaking)
✅ Hot reload development mode
✅ Production-ready bundling
✅ Plugin instance support
✅ Convention-based discovery

### What's Not Included
❌ HTTP-only transport (SSE migration)
   → Blocked on technical issues, may never need (WebSocket works fine)

---

## Risk Management

### Phase 1 Risks (Path + Logger)
- **Risk:** Breaking changes affect existing deployments
- **Mitigation:** Breaking changes acceptable (few users), migration guide provided
- **Risk:** Logger complexity underestimated
- **Mitigation:** Follow `logger-architecture-recommendations.md` exactly, don't cut corners

### Phase 2 Risks (Vite)
- **Risk:** Dynamic imports may break
- **Mitigation:** Test all code-splitting points, use Vite's dynamic import syntax
- **Risk:** WebSocket connection issues
- **Mitigation:** Same server, same port - should simplify

### Phase 3 Risks (HIL + Project-Based)
- **Risk:** Build system complexity (Rollup + esbuild)
- **Mitigation:** Study Mastra's implementation, allocate full 2-3 weeks
- **Risk:** Plugin discovery edge cases
- **Mitigation:** Clear validation and error messages

---

## Critical: What NOT To Do

### ❌ Don't Separate Path and Logger
**Why:** Logger isolation requires per-agent paths. If you do path migration without logger refactor, you'll still have `getDextoPath()` in `logger.ts:198` and need to redo enrichment layer later.

### ❌ Don't Do "Simple Logger Config"
**Why:** `migration.md` Phase 1 says "4-6 hours" but `logger-architecture-recommendations.md` says "12-16 hours for Phase 1 alone". The simple approach is a trap - you'll rebuild it for transports.

### ❌ Don't Start HIL Before DI Pattern Exists
**Why:** `agent.setApprovalHandler()` is dependency injection. Current code has no DI. You need logger DI work (Phase 1) to establish the pattern first.

### ❌ Don't Treat Plugin Instances as Separate Work
**Why:** `core-refactors.md` is architectural guidance. The actual implementation is in `project-based-architecture.md` Phase 5 (helper functions & types).

### ❌ Don't Implement SSE Yet
**Why:** Plan explicitly says "DO NOT IMPLEMENT YET" with 5 unresolved technical blockers. Wait for solutions or user demand.

---

## Success Metrics

### After Phase 1 (Path + Logger)
- Zero `getDextoPath()` imports in core package
- All services use dependency injection
- Per-agent log files in `~/.dexto/logs/{agentId}/`
- CLI enrichment layer tested with all execution contexts

### After Phase 2 (Vite)
- Single `dexto start` command (not two processes)
- Memory usage <60MB (currently ~130MB)
- Startup time <1s (currently ~3s)
- Bundle size <800KB gzipped

### After Phase 3 (HIL + Project-Based)
- `agent.setApprovalHandler()` works with custom handlers
- Manual mode requires handler (fail-fast error)
- `dexto init` creates working project structure
- `dexto build` produces optimized bundle
- `dexto dev` hot reloads in <500ms
- Full TypeScript autocomplete in plugin development

---

## Coordination Notes

### If Multiple Developers

**Weeks 1-5**: One stream (Path + Logger)
- This is foundation work, hard to split
- Code review is critical here (DI pattern sets precedent)

**Weeks 6-7.5**: One stream (Vite)
- Small team can knock this out quickly
- Good for less experienced dev (clear migration path)

**Weeks 8-14**: Two parallel streams
- **Stream A** (more experienced): Project-Based build system
- **Stream B** (mid-level): HIL handler redesign
- Daily syncs to ensure DI pattern alignment

### If Solo Developer

Follow the timeline exactly:
1. Deep focus on Path + Logger (weeks 1-5)
2. Quick Vite win for morale (weeks 6-7.5)
3. HIL first, then Project-Based (weeks 8-14)
   - Can't truly parallelize as solo dev
   - HIL is smaller, finish it first
   - Then tackle the hard build system work

---

## Related Documents

- `README.md` - Overview of all plans and their summaries
- `migration.md` - Path utilities & logger migration details
- `logger-architecture-recommendations.md` - Full logger refactoring guide
- `webui-vite-migration.md` - Next.js to Vite migration details
- `human-in-loop-handler-redesign.md` - HIL handler-first API design
- `project-based-architecture.md` - Two-tier project mode details
- `websocket-to-sse-migration.md` - SSE migration plan (deferred)
- `core-refactors.md` - Architectural guidance on config vs instances
- `research/` - Background analysis and trade-off discussions

---

## Revision History

- **2025-01-05**: Initial version - Defined implementation order based on dependency analysis
