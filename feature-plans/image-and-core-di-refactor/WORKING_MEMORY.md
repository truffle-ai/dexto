# Working Memory — DI Refactor

> **This file is a live scratchpad for agents working through the DI refactor plan.**
> Update it after completing each task. Read it before starting any task.

---

## How to use this file

1. **Before starting work:** Read the "Current Task" and "Key Decisions" sections to understand where things left off.
2. **When starting a task:** Update "Current Task" with the task ID, title, and your initial plan.
3. **During a task:** Log findings, blockers, and decisions in "Current Task Notes."
4. **After completing a task:** Move the task to "Completed Tasks," clear "Current Task Notes," and update "Current Task" to the next one.
5. **If you discover something unexpected:** Add it to "Open Questions / Blockers" or "Key Decisions."

---

## Current Task

**Task:** **1.10 — `agent/DextoAgent.ts` — constructor accepts `DextoAgentOptions`**
**Status:** _Not started_
**Branch:** `rebuild-di`

### Plan
- Update `DextoAgent` constructor to take a single `DextoAgentOptions` object.
- Ensure `ToolExecutionContext` / `PluginExecutionContext` are built after full construction (avoid init cycles).
- Remove remaining `ValidatedAgentConfig`-typed surfaces from agent shell (caller breaks expected; fix later phases).
- Ensure `pnpm run build` and `pnpm test` pass.

### Notes
_Log findings, issues, and progress here as you work._

---

## Key Decisions

_Record important decisions made during implementation that aren't in the main plan. Include date and reasoning._

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-02-10 | Tool IDs must be fully-qualified (`internal--*`, `custom--*`) when handed to `ToolManager` | Keeps `ToolManager` DI-only and avoids re-introducing config/prefixing rules inside core. |
| 2026-02-10 | `PluginManager` no longer loads plugins from config | Keeps `PluginManager` DI-only; config→instance resolution moved to a temporary resolver helper. |

---

## Open Questions / Blockers

_Things that need resolution before proceeding. Remove when resolved (move to Key Decisions)._

- _None yet_

---

## Completed Tasks

_Move tasks here after completion. Keep a brief log of what was done and any deviations from the plan._

| Task | Title | Date | Notes |
|------|-------|------|-------|
| 0.1 | Create `@dexto/agent-config` package skeleton | 2026-02-09 | Added `packages/agent-config/` skeleton + fixed-versioning entry; `pnpm -C packages/agent-config build` passes; pnpm/turbo already include `packages/*` so no extra wiring needed. |
| 0.2 | Define `DextoImageModule` + factory types | 2026-02-09 | Added `packages/agent-config/src/image/types.ts` + exports; added deps (`@dexto/core`, `zod`); `pnpm -C packages/agent-config build` passes. (Uses existing core types: `InternalTool` as `Tool`, `ICompactionStrategy` as `CompactionStrategy` for now.) |
| 0.3 | Define `DextoAgentOptions` interface in core | 2026-02-09 | Added `packages/core/src/agent/agent-options.ts` + exported from `packages/core/src/agent/index.ts`; `pnpm -C packages/core build` passes. |
| 0.4 | Clean DI surface interfaces in core | 2026-02-09 | Removed `any` from DI surface interfaces (`DextoPlugin` payload/config shapes, `ToolResult`, provider generics). `pnpm -C packages/core build` passes. |
| 0.5 | Define `ToolExecutionContext` + `PluginExecutionContext` interfaces | 2026-02-09 | Expanded `ToolExecutionContext` with DI-friendly runtime fields; ensured `PluginExecutionContext` is `any`-free; removed remaining `any` from `ToolManager.setAgent`; tagged temporary glue with `TODO: temporary glue code to be removed/verified`. `pnpm -C packages/core build` + `pnpm -C packages/agent-config build` pass. |
| 1.1 | `storage/blob/` — decouple from registry | 2026-02-09 | Deleted blob storage registry + tests; removed module-load auto-registration; `createBlobStore()` now supports built-in types only (temporary glue); updated provider discovery to list built-in blob providers. `pnpm -C packages/core build` passes. |
| 1.2 | `storage/database/` — decouple from registry | 2026-02-09 | Deleted database registry + tests; removed module-load auto-registration; `createDatabase()` now supports built-in types only (temporary glue); updated provider discovery to list built-in database providers. `pnpm -C packages/core build` + `pnpm test` pass. |
| 1.3 | `storage/cache/` — decouple from registry | 2026-02-09 | Deleted cache registry + tests; removed module-load auto-registration; `createCache()` now supports built-in types only (temporary glue); added `StorageError.cacheInvalidConfig`; updated storage exports. `pnpm -C packages/core build` + `pnpm test` pass. |
| 1.4 | `storage/storage-manager.ts` — accept concrete instances | 2026-02-09 | `StorageManager` now accepts concrete backends (`{ cache, database, blobStore }`); creation moved into `createStorageManager()` helper (temporary glue) and tagged. `pnpm -C packages/core build` + `pnpm test` pass. |
| 1.5 | `tools/custom-tool-registry.ts` — mark for deletion | 2026-02-09 | Documented core dependency map + tagged `custom-tool-registry.ts` and `custom-tool-schema-registry.ts` as temporary glue. `pnpm -C packages/core build` + `pnpm test` pass. |
| 1.6 | `tools/internal-tools/` — decouple built‑in tool creation | 2026-02-10 | `InternalToolsProvider` now handles built-in tools only (no `customToolRegistry` imports). Custom tool registration/execution moved into `ToolManager` as **temporary glue** (tagged). Updated `provider.test.ts` and added `ToolManager` coverage for custom tools. `pnpm -C packages/core build` + `pnpm test` pass. (Follow-up: rename `InternalTool` → `Tool` once tool surfaces are consolidated.) |
| 1.7 | `tools/tool-manager.ts` — accept unified `Tool[]` + provide `ToolExecutionContext` at runtime | 2026-02-10 | `ToolManager` now accepts a unified local `Tool[]` (still `InternalTool` for now) and injects runtime `ToolExecutionContext` via a factory. Tool resolution moved out of `ToolManager` into `agent/resolve-local-tools.ts` + `DextoAgent.start()` as **temporary glue** (tagged). Updated tool-manager unit/integration tests + lifecycle mocks. `pnpm run build` + `pnpm test` pass. |
| 1.8 | `plugins/manager.ts` — accept concrete `DextoPlugin[]` | 2026-02-10 | `PluginManager` now accepts pre-resolved plugins and no longer loads from file paths or registries. Deleted plugin registry + loader + builtins registration; added `agent/resolve-local-plugins.ts` as **temporary glue** for built-ins and updated bundler/templates to remove `pluginRegistry`. Added `plugins/manager.test.ts`. `pnpm run build` + `pnpm test` pass. |
| 1.9 | `context/compaction/` — decouple from registry, accept `CompactionStrategy` | 2026-02-10 | Deleted compaction registry + tests; `createCompactionStrategy()` now resolves built-ins via a `switch` (temporary glue, tagged). Updated provider discovery + templates/bundler + integration tests. Added `context/compaction/factory.test.ts`. `pnpm run build` + `pnpm test` pass. |

---

## Phase Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Foundation | Completed | 0.1–0.5 complete |
| Phase 1A — Storage layer | Completed | 1.1–1.4 complete |
| Phase 1B — Tools layer | Completed | 1.5–1.7 complete |
| Phase 1C — Plugins layer | Completed | 1.8 complete |
| Phase 1D — Compaction | Completed | 1.9 complete |
| Phase 1E — Agent shell | Not started | |
| Phase 1F — Vet + cleanup | Not started | |
| Phase 2 — Resolver | Not started | |
| Phase 3 — Images | Not started | |
| Phase 4 — CLI/Server | Not started | |
| Phase 5 — Cleanup | Not started | |

---

## Checkpoint Log

_Record checkpoint validation results after each phase boundary._

| Phase boundary | Date | Result | Issues |
|----------------|------|--------|--------|
| After Phase 1B (commit 1.7) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
| After Phase 1C (commit 1.8) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
| After Phase 1D (commit 1.9) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
