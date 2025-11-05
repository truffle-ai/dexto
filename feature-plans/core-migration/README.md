# Core Migration Feature Plans

This folder contains implementation plans for major architectural changes and migrations in Dexto's core, server, and WebUI packages.

## Status Legend

- ✅ **Ready** - Fully specified, ready for implementation
- ⚠️ **WIP** - Work in progress, needs more clarification
- 🚧 **Draft** - Early stage, may change significantly

---

## Architectural Foundations

Before diving into implementation plans, these documents establish core architectural principles:

### `core-refactors.md` - Config vs Instances Architecture
Establishes that Dexto maintains a **config-first philosophy** for most modules (LLM, storage, MCP, sessions, telemetry, etc.), with instance support added only for **plugins**. Based on systematic analysis of every module in the codebase.

**Key principle:** Config is the right abstraction for declarative concerns. Instances are only beneficial where users must write custom code (plugins).

### `logger-architecture-recommendations.md` - Logger Refactoring Guide
Comprehensive recommendations for refactoring Dexto's logger based on Mastra's transport-based architecture. Includes:
- Multi-transport support (file, console, remote services)
- Per-agent log isolation
- Structured logging with context
- Dependency injection patterns

**Referenced by:** `migration.md` (Phase 2)

---

## Implementation Plans

### ✅ `migration.md` - Path Utilities & Logger Migration
**Scope:** Core (`@dexto/core`) + CLI (`@dexto/cli`)
**Complexity:** Moderate
**Timeline:** 3-4 weeks

Remove hardcoded file-based defaults from core to enable serverless compatibility. Move path utilities to CLI layer with per-agent isolation through config enrichment. Refactor logger to be config-driven with dependency injection.

**Key changes:**
- Remove `getDextoPath()` fallbacks from all services
- CLI enrichment layer sets per-agent defaults
- Logger configuration in AgentConfigSchema
- Move path utilities from core to `@dexto/agent-management`

---

### ✅ `project-based-architecture.md` - Two-Tier Project Mode
**Scope:** CLI (`@dexto/cli`) + Core (`@dexto/core`)
**Complexity:** High
**Timeline:** 5-7 weeks (reduced from 9 weeks due to existing Hono server)

Support both standalone YAML files (simple mode) and opinionated project structure with build system (project mode), inspired by Next.js progressive complexity model.

**Key changes:**
- `dexto init` creates project structure (`agents/`, `plugins/`, `tools/`)
- Convention-based plugin discovery (plugins referenced by name)
- Build system with Rollup + esbuild for production bundling
- Hot reload development mode with `dexto dev`
- Integrates with existing `@dexto/server` Hono infrastructure

**Related:** See `research/instance-vs-config-grounded-analysis.md` for why only plugins need custom code support.

---

### ✅ `webui-vite-migration.md` - Next.js to Vite Migration
**Scope:** WebUI (`@dexto/webui`) + Server (`@dexto/server`)
**Complexity:** Moderate
**Timeline:** 1.5-2.5 weeks

Migrate WebUI from Next.js standalone to Vite SPA for simpler architecture, faster dev experience, and single-process deployment.

**Key changes:**
- Replace Next.js App Router with React Router
- Vite build instead of Next.js standalone server
- Hono serves static SPA files
- Remove separate Next.js process spawning
- 60% reduction in memory usage, 6x faster startup

---

### ✅ `human-in-loop-handler-redesign.md` - HIL Handler-First API
**Scope:** Core (`@dexto/core`) + Server (`@dexto/server`)
**Complexity:** Moderate
**Timeline:** 4 weeks

Make human-in-the-loop approvals transport-agnostic with explicit handler registration. Prevents silent hangs for library users and enables custom approval flows.

**Key changes:**
- Rename `event-based` → `manual` mode
- Add `agent.setApprovalHandler()` runtime API
- Require handler at construction time (fail-fast)
- WebSocket becomes one handler implementation, not the only option
- Enables CLI prompts, REST-only, custom UI approval flows

---

### ⚠️ `websocket-to-sse-migration.md` - HTTP-Only Architecture
**Status:** WORK IN PROGRESS - DO NOT IMPLEMENT YET
**Scope:** Server (`@dexto/server`) + WebUI (`@dexto/webui`)
**Complexity:** High
**Timeline:** 6-8 weeks (estimated)

Replace WebSocket with SSE for server→client events and REST for client→server commands. Simplifies infrastructure and enables serverless deployment.

**Open issues:**
- EventSource auth limitations (can't send custom headers)
- Error handling strategy (EventSource errors lack context)
- Race conditions between POST and events
- Reconnection edge cases (HIL approvals during disconnect)
- Proxy configuration (buffering issues)

**Next steps:**
- Research EventSource auth patterns
- Prototype with real agent interactions
- Test proxy behavior
- Resolve edge cases before implementation

---

## Research Documents

See `research/` folder for analysis and trade-off discussions that informed these architectural decisions:
- `code-first-api-design.md` - Initial exploration of instance-first architecture (superseded)
- `instance-first-architecture-analysis.md` - Full trade-off analysis (concluded against full refactor)
- `instance-vs-config-grounded-analysis.md` - Evidence-based conclusion (informed `core-refactors.md`)

These documents provide historical context and detailed reasoning behind our architectural choices. See `research/README.md` for detailed descriptions of each document.

---

## Implementation Priority

Suggested order (can be done in parallel where noted):

1. **HIL handler redesign** - Foundation for other changes
2. **Path utilities migration** - Removes file-based assumptions
3. **Vite migration** *(can be parallel with #4)* - Simplifies WebUI
4. **Project-based architecture** *(can be parallel with #3)* - Big feature
5. **WebSocket to SSE** *(after resolving open issues)* - Infrastructure change

---

## Breaking Changes

All plans involve breaking changes. This is acceptable as Dexto has few users currently. Migration guides provided in each plan.

---

## Questions?

For questions or to propose new plans, create an issue or discuss in team channels.
