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
6. **When adding glue code:** Tag it with `// TODO: temporary glue code to be removed/verified (remove-by: <phase.task>)` (default `remove-by: 5.1`). **Low-churn backfill:** only add/remove `remove-by` tags when touching the surrounding code; Phase 5.1 is the hard cleanup gate.
7. **When you discover owner-only decisions or manual checks:** Add/update an item in `USER_VERIFICATION.md` (and mark items resolved when done).

---

## Current Task

**Task:** **5.4 Update documentation**
**Status:** _Deferred_ (Do not do in this plan)
**Branch:** `rebuild-di`

### Plan
- No-op: explicitly deferred per `PLAN.md`
- Only revisit if the owner asks for docs updates in a follow-up

### Notes
_Log findings, issues, and progress here as you work._
2026-02-11:
- Completed Phase 5.3 (additional resolver + image conformance unit coverage).
- Confirmed `bash scripts/quality-checks.sh` passes.
- Reviewed/cleared `USER_VERIFICATION.md` (UV-1 resolved: keep `ImageTarget` / `ImageConstraint` for now).
- Phase 5.4 docs task remains intentionally deferred per `PLAN.md` (do not do).
2026-02-11:
- Merged `main` into `rebuild-di` (conflicts in `ToolManager` + agent-spawner legacy provider deletion).
- Post-merge fixes: align `agentSpawnerToolsFactory` with `createSpawnAgentTool(service)` signature; sync OpenAPI docs; update session token-tracking integration tests to new DI agent construction.
- Confirmed `bash scripts/quality-checks.sh` passes.

---

## Key Decisions

_Record important decisions made during implementation that aren't in the main plan. Include date and reasoning._

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-02-10 | Tool IDs must be fully-qualified (`internal--*`, `custom--*`) when handed to `ToolManager` | Keeps `ToolManager` DI-only and avoids re-introducing config/prefixing rules inside core. |
| 2026-02-10 | `PluginManager` no longer loads plugins from config | Keeps `PluginManager` DI-only; config→instance resolution moved to a temporary resolver helper. |
| 2026-02-10 | Expose `agent.on/once/off/emit` and remove external `agentEventBus` access | Keeps typed events ergonomic while preventing host layers from reaching into core internals; allows gradual migration of subscribers/tools without passing the bus around. |
| 2026-02-10 | Core no longer resolves storage from config | Core remains interface-only; host layers supply a `StorageManager` (temporary glue via `@dexto/storage/createStorageManager`) until the image resolver is fully integrated. |
| 2026-02-10 | Defer `@dexto/logger` extraction (keep logger in core for now) | Avoids core codepaths needing `console.*` fallbacks/inline loggers and reduces churn; revisit later with a cleaner types-vs-impl split if extraction is still desired. |
| 2026-02-10 | `resolveServicesFromConfig()` prefixes tool IDs + wraps plugins | Ensures tools are fully-qualified (`internal--*`/`custom--*`) and plugin blocking semantics match legacy behavior before handing instances to core. |
| 2026-02-10 | Reactive-overflow compaction remains core-owned (per session) | DI compaction creation at config-resolution time cannot supply a per-session `LanguageModel`. Resolver skips DI for `reactive-overflow`; core continues to create it during session init. |
| 2026-02-10 | `loadImage()` supports host-configured importer (`setImageImporter`) | `@dexto/agent-config` cannot reliably `import('@dexto/image-*')` under pnpm unless the image is a direct dependency; hosts configure the importer to resolve relative to the host package. |
| 2026-02-11 | Tool approval overrides receive `ToolExecutionContext` | Enables filesystem directory approval to use `ApprovalManager` without factory-time glue; removes noop logger / local approval maps. |
| 2026-02-11 | Tool provider packages export `ToolFactory` only | Removes dead registry-based `CustomToolProvider` surfaces after Phase 5.1; keeps tool packages image-compatible. |
| 2026-02-11 | Image factories include optional `metadata` | Keeps discovery responses type-safe (no casts) while preserving passthrough metadata for UI/CLI. |

---

## Open Questions / Blockers

_Things that need resolution before proceeding. Remove when resolved (move to Key Decisions)._

- UV-1 reopened: decide whether to keep `ImageTarget` / `ImageConstraint` enums in `@dexto/agent-config` or simplify/remove (see `USER_VERIFICATION.md`).

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
| 1.10 | `agent/DextoAgent.ts` — constructor accepts `DextoAgentOptions` | 2026-02-10 | `DextoAgent` now takes `{ config, configPath?, overrides?, logger? }` and does no config parsing in the constructor; callers validate config first. Updated agent-management, CLI/server, bundler output, and templates. `pnpm run build` + `pnpm test` pass. |
| 1.11 | `utils/service-initializer.ts` — rewrite | 2026-02-10 | Removed `configDir`/`configPath` from core service wiring; `SystemPromptManager` no longer takes `configDir`. Updated unit/integration tests. `pnpm run build` + `pnpm test` pass. |
| 1.12 | `llm/` — vet | 2026-02-10 | No changes needed. Verified no provider registries/config-resolution coupling. (LLM “registry” is model metadata + capability helpers and is legitimate.) |
| 1.13 | `mcp/` — vet | 2026-02-10 | No changes needed. Verified MCP stays config-driven; no provider registries or global registries involved. |
| 1.14 | `session/` — vet | 2026-02-10 | No changes needed. Verified no provider registries; only references to LLM model registry helpers for token/pricing metadata (legitimate). |
| 1.15 | `memory/` — vet | 2026-02-10 | No changes needed. `MemoryManager` is already DI-compatible (database + logger), no registries involved. |
| 1.16 | `systemPrompt/` — vet | 2026-02-10 | No changes needed. `SystemPromptManager` no longer takes `configDir` (handled in 1.11). `systemPrompt/registry.ts` is an internal prompt-generator registry (not a provider registry). |
| 1.17 | `approval/` — vet | 2026-02-10 | No changes needed. Approval is config-driven and DI-compatible; no provider registries involved. |
| 1.18 | `search/` — vet | 2026-02-10 | No changes needed. `SearchService` is DI-compatible (database + logger) and registry-free. |
| 1.19 | `resources/` — vet | 2026-02-10 | No changes needed. `ResourceManager` stays config-driven and DI-compatible; no provider registries involved. |
| 1.20 | `prompts/` — vet | 2026-02-10 | No changes needed. Prompt manager/providers are config-driven + DI-compatible; no provider registries involved. |
| 1.21 | `logger/` — vet | 2026-02-10 | Core no longer creates loggers from config; `DextoAgentOptions.logger` is required and host layers construct loggers (via `createLogger(...)`) and pass them in. Updated agent-management, CLI/server call sites, image bundler output, and CLI templates/tests. `pnpm run build` + `pnpm test` pass. |
| 1.22 | `telemetry/` — vet | 2026-02-10 | No changes needed. Telemetry is config-driven (`OtelConfigurationSchema`) and registry-free. Init stays in `service-initializer.ts` and is idempotent via a global singleton. |
| 1.23 | `events/` — vet | 2026-02-10 | Added `DextoAgent.on/once/off/emit` typed delegates and made the internal bus non-public. Migrated CLI/server/tooling to use `agent.*` APIs or `agent.registerSubscriber(...)` instead of `agent.agentEventBus.*`. Updated streaming glue to accept an event emitter (emit-only) for auto-approvals. `pnpm run build` + `pnpm test` pass. |
| 1.24 | `errors/` — vet | 2026-02-10 | No changes needed. Error infrastructure is registry-free and remains DI-neutral. |
| 1.25 | `utils/` — vet | 2026-02-10 | No changes needed. Verified `packages/core/src/utils/` (excluding `service-initializer.ts`) has no provider-registry coupling; remaining utilities are DI-neutral. |
| 1.26 | `providers/` — delete registry infrastructure | 2026-02-10 | Deleted `packages/core/src/providers/*` and removed core exports. Refactored `CustomToolRegistry` to no longer depend on `BaseRegistry`. Moved `/discovery` provider listing logic into server route. `pnpm run build` + `pnpm test` pass. |
| 1.27 | `image/` — remove old image infrastructure from core | 2026-02-10 | Deleted `packages/core/src/image/*` and removed core exports. Moved legacy image definition types + validation into `@dexto/image-bundler`, updated `@dexto/image-local` and CLI templates to stop importing `defineImage` from core. `pnpm run build` + `pnpm test` pass. |
| 1.28 | `index.ts` barrel — remove deleted exports | 2026-02-10 | Removed `customToolSchemaRegistry` from public exports (it’s an internal implementation detail). Audited core index barrels for now-deleted provider/image exports. `pnpm run build` + `pnpm test` pass. |
| 1.29 | Final validation — all registries gone from core | 2026-02-10 | Verified no legacy provider registry symbols remain (only a `BaseRegistry` mention in a comment). Ran `pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck` (all pass). Fixed a core typecheck failure in `custom-tool-registry.test.ts` by using a typed `SearchService` stub. |
| 2.5 | Move `AgentConfigSchema` + DI schemas to agent‑config | 2026-02-10 | Moved `AgentConfigSchema`/`ValidatedAgentConfig` into `@dexto/agent-config` and updated CLI/server/agent-management/webui/image-bundler imports. Unified tool config to `tools: ToolFactoryEntry[]` (A+B+C semantics + common `enabled?: boolean`). Added `packages/core/src/agent/runtime-config.ts` (schema-free core runtime config). Updated first-party `agents/*.yml`. Re-enabled schema coverage by moving `AgentConfigSchema` tests into agent-config. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 2.1 | `applyImageDefaults(config, imageDefaults)` | 2026-02-10 | Defined `ImageDefaults` as `Partial<AgentConfig>` and implemented `applyImageDefaults()` in agent-config (shallow merge + 1-level object merge; arrays atomic). Added unit tests. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 2.2 | `resolveServicesFromConfig(config, image)` | 2026-02-10 | Implemented service resolver for `logger`/`storage`/`tools`/`plugins`/`compaction` with clear unknown-type errors. Tools honor `enabled: false` and strip `enabled` before validating strict factory schemas. Added unit tests. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 2.6 | `ValidatedAgentConfig → DextoAgentOptions` transformer | 2026-02-10 | Added `toDextoAgentOptions()` bridge in agent-config (validated config + resolved services → `DextoAgentOptions`). Unit test added. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 2.3 | `loadImage(imageName)` helper | 2026-02-10 | Added `loadImage()` dynamic import wrapper + runtime shape validation for `DextoImageModule` (with clear error messages). Unit tests cover success + import failure + shape mismatch. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 3.1 | Create `@dexto/tools-builtins` package | 2026-02-10 | Added `packages/tools-builtins/` and exported `builtinToolsFactory` (`builtin-tools` + optional `enabledTools`). Tool implementations use `ToolExecutionContext` services at runtime. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 3.2 | Create `@dexto/storage` package | 2026-02-10 | Added `packages/storage/` (schemas + providers + factories) and removed concrete storage implementations/schemas from core (core is interfaces + `StorageManager` only). Updated host layers (CLI/server/agent-management) to inject `overrides.storageManager`. Updated webui to import storage types/constants from `@dexto/storage/schemas`. `pnpm -w build:packages` passes. |
| 3.4 | Adapt existing tool provider packages | 2026-02-10 | Added `ToolFactory` exports for `@dexto/tools-filesystem`, `@dexto/tools-process`, `@dexto/tools-todo`, `@dexto/tools-plan` for image-local consumption (registry-free). `pnpm -w build:packages` + `pnpm -w test` pass. |
| 3.5 | Rewrite `@dexto/image-local` as hand-written `DextoImageModule` | 2026-02-10 | Deleted bundler entrypoint and replaced with hand-written `DextoImageModule` export. Added `defaultLoggerFactory` in core and a lazy `agentSpawnerToolsFactory` adapter in agent-management. Included a temporary placeholder for `reactive-overflow` compaction (remove-by: 4.1). `pnpm -w build:packages` + `pnpm -C packages/image-local test` pass. |
| 3.6 | Update `@dexto/image-bundler` | 2026-02-10 | Bundler now generates a `DextoImageModule` (explicit imports, no `.toString()`, no duck-typing). Providers are discovered from convention folders and must export `provider`. Updated `dexto create-image` scaffolding/templates to match new folder structure + provider contract. Added a bundler integration test. `pnpm -w build:packages` + `pnpm -w test` pass. |
| 4.1 | Update CLI entry point (`packages/cli/src/index.ts`) | 2026-02-10 | CLI now loads typed images (`loadImage()`), applies defaults, resolves services, and constructs `DextoAgent` via `toDextoAgentOptions()` (no `imageMetadata`). Core consumes DI-provided `storage/tools/plugins` and bridges storage backends into a `StorageManager`. Removed image-bundler `imageMetadata` export and deprecated `bundledPlugins` in image definitions. `pnpm -w run build:packages` + `pnpm -w test` pass. |
| 4.2 | Update CLI server mode (`packages/cli/src/api/server-hono.ts`) | 2026-02-10 | Server mode agent switching now uses the same image DI flow as the CLI entrypoint (`loadImage()` → `applyImageDefaults()` → `resolveServicesFromConfig()` → `toDextoAgentOptions()`). Removed `imageMetadata`/`bundledPlugins` plumbing and ensured switched agents reuse the session file-logger override. Added small CLI utils for `cleanNullValues()` + `createFileSessionLoggerFactory()` to avoid duplication. `pnpm -w run build:packages` + `pnpm -w test` pass. |
| 4.3 | Update `@dexto/server` if needed | 2026-02-10 | No code changes required; server consumes a `DextoAgent` instance. Verified `pnpm -w run build:packages` + `pnpm -w test` pass. |
| 4.4 | Update `@dexto/agent-management` config enrichment + agent creation surfaces | 2026-02-10 | `AgentManager.loadAgent`, `AgentFactory.createAgent`, and `AgentRuntime.spawnAgent` now create agents via image DI resolution (`loadImage()` + defaults + resolver) instead of core glue (`createLogger`/`createStorageManager`). Added shared `cleanNullValues()` export in agent-config. Removed unused `@dexto/storage` dependency from agent-management. `pnpm -w run build:packages` + `pnpm -w test` pass. |
| 4.5 | End-to-end smoke test | 2026-02-10 | Fixed pnpm image import via `setImageImporter()` and wired it in the CLI entrypoint. Manual smoke: headless prompt, server mode APIs, and agent switching work. Also fixed typecheck breakages in core/webui/agent-management after `tools` schema + storage extraction. `pnpm -w run build:packages` + `pnpm -w test` + `pnpm -w run lint` + `pnpm -w run typecheck` pass. |
| 5.0 | Flatten `DextoAgentOptions` + remove core config indirection | 2026-02-11 | Core options are now flat (`DextoAgentOptions extends AgentRuntimeSettings` + injected DI surfaces). Removed core file-path concerns and updated host layers. `pnpm -w run build:packages` passes. |
| 5.1 | Delete dead registry code | 2026-02-11 | Deleted remaining core tool registries + internal-tools and removed all `temporary glue code` markers. Updated tool packages to remove legacy provider exports. Updated filesystem tools to use runtime approval via `ToolExecutionContext`. Exit check: `rg "temporary glue code|remove-by:" packages` returns 0. |
| 5.2 | Update all broken tests | 2026-02-11 | Updated tests that referenced deleted registry-era schemas/tools and updated filesystem tool tests for new signatures. `pnpm -w test` passes. |
| 5.3 | Add new test coverage | 2026-02-11 | Added resolver tests (tool prefixing/conflicts, schema failures, plugin priority conflicts) and expanded `loadImage()` conformance tests. `bash scripts/quality-checks.sh` passes. |
| 5.5 | Update OpenAPI / server docs if affected | 2026-02-11 | Ran `pnpm run sync-openapi-docs` and verified `sync-openapi-docs:check` passes. |
| 5.6.1 | Review and resolve `USER_VERIFICATION.md` | 2026-02-11 | Completed an initial review, but UV-1 was re-opened pending explicit owner approval. |

---

## Phase Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Foundation | Completed | 0.1–0.5 complete |
| Phase 1A — Storage layer | Completed | 1.1–1.4 complete |
| Phase 1B — Tools layer | Completed | 1.5–1.7 complete |
| Phase 1C — Plugins layer | Completed | 1.8 complete |
| Phase 1D — Compaction | Completed | 1.9 complete |
| Phase 1E — Agent shell | Completed | 1.10–1.11 complete |
| Phase 1F — Vet + cleanup | Completed | 1.12–1.29 complete |
| Phase 2 — Resolver | Completed | 2.5, 2.1, 2.2, 2.6, 2.3 complete (2.4 deferred) |
| Phase 3 — Images | Completed | 3.3 deferred; 3.5 image-local + 3.6 bundler updated |
| Phase 4 — CLI/Server | Completed | 4.1–4.5 complete |
| Phase 5 — Cleanup | In progress | 5.0–5.3 + 5.5 complete; 5.4 deferred; 5.6 pending (UV-1 reopened) |

---

## Checkpoint Log

_Record checkpoint validation results after each phase boundary._

| Phase boundary | Date | Result | Issues |
|----------------|------|--------|--------|
| After Phase 1B (commit 1.7) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
| After Phase 1C (commit 1.8) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
| After Phase 1D (commit 1.9) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` pass | — |
| After Phase 1F (commit 1.29) | 2026-02-10 | ✅ `pnpm run build` + `pnpm test` + `pnpm run lint` + `pnpm run typecheck` pass | — |
| After Phase 2 | 2026-02-10 | ✅ `pnpm -w run build:packages` + `pnpm -w test` pass | — |
| After Phase 3 (commit 3.6) | 2026-02-10 | ✅ `pnpm -w run build:packages` + `pnpm -w test` pass | Logger extraction deferred; compaction DI mismatch tracked (remove-by: 4.1) |
| After Phase 4 (commit 4.5) | 2026-02-10 | ✅ `pnpm -w run build:packages` + `pnpm -w test` + `pnpm -w run lint` + `pnpm -w run typecheck` pass | Manual smoke pass; pnpm image import fixed via `setImageImporter()`. |
| After Phase 5.1 (pre-commit) | 2026-02-11 | ✅ `/quality-checks` pass | OpenAPI docs regenerated via `pnpm run sync-openapi-docs`. |
