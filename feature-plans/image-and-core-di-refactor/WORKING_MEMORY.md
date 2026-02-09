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

**Task:** **1.3 — `storage/cache/` — decouple from registry**
**Status:** _Not started_
**Branch:** `rebuild-di`

### Plan
- Identify all registry/factory/auto-register paths under `packages/core/src/storage/cache/`.
- Remove `cacheRegistry` usage and auto-registration side effects; keep concrete implementations + schemas as plain exports.
- Update any importers (within core) to keep build passing.
- Ensure `pnpm -C packages/core build` passes after the change.

### Notes
_Log findings, issues, and progress here as you work._

---

## Key Decisions

_Record important decisions made during implementation that aren't in the main plan. Include date and reasoning._

| Date | Decision | Reasoning |
|------|----------|-----------|
| — | — | — |

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

---

## Phase Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Foundation | Completed | 0.1–0.5 complete |
| Phase 1A — Storage layer | In progress | 1.1 complete; starting 1.2 |
| Phase 1B — Tools layer | Not started | |
| Phase 1C — Plugins layer | Not started | |
| Phase 1D — Compaction | Not started | |
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
| — | — | — | — |
