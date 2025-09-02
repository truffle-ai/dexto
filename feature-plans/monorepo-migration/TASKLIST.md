# Monorepo Migration Tasklist (Live)

Track progress here. Update checkboxes as tasks complete.

## Global Setup
- [x] Enforce pnpm via root `preinstall: npx only-allow pnpm`
- [x] Add `pnpm-workspace.yaml` (targets `src/packages/*`)
- [x] Add `turbo.json` (build/test/lint/typecheck pipelines, outputs)
- [x] Add `tsconfig.base.json`
- [x] Initialize Changesets (`.changeset/`), configure fixed group for lockstep
- [x] Add root scripts: repo-level turbo scripts (`repo:build`, `repo:test`, `repo:lint`, `repo:typecheck`)
  - [x] Add `turbo` as a devDependency and set `packageManager` field

## Phase 2 — Package `@dexto/core`
- [x] Move `src/core` → `src/packages/core/src`
- [x] Create `src/packages/core/package.json` (exports, types). Use root tsup for now.
- [x] Update path aliases to `@core/*` → `src/packages/core/src/*` (root, vitest, next/webui)
- [x] Add per-package tsup config
- [x] Typecheck/lint package (package-level)
  - [x] Centralize LLM types/constants in `llm/types.ts`; registry consumes them
  - [x] Add browser-safe logger build target (`logger/browser`) and map via `package.json#browser`

## Phase 3 — Package `dexto` (CLI)
- [x] Move `src/app` → `src/packages/cli/src`
- [x] Create `src/packages/cli/package.json` (`type: module`, scripts)
- [x] Migrate/adjust tsup config for CLI build
- [x] Update copy script paths (kept at root; optional move into `dexto` later)
- [ ] Verify `dexto` works: cli, web, server modes
- [x] Add per-package tsup/tsconfig for CLI

## Phase 4 — Package `@dexto/webui` (Next.js)
- [x] Move `src/app/webui` → `src/packages/webui`
- [ ] Ensure webui build works; update alias/transpile if needed
- [x] Update `dexto` build to run webui build and copy `.next/standalone`
- [x] Add package-local ESLint config with browser‑safety rules (types‑only + `toError`; forbid `@core/*`)

## Phase 5 — Core API Surface (Browser‑Safe Root + Subpaths)
- [~] Make `@dexto/core` root export browser‑safe only (no logger/storage/config/path/env/fs)
  - Current: Root re‑exports some Node‑only symbols temporarily for CLI; keep until CLI refactor lands
- [x] Add `@dexto/core/logger` subpath (public logger API)
- [x] Add `@dexto/core/storage` subpath (public storage API) if needed
- [x] Update `src/packages/core/package.json` exports map accordingly
- [x] Adjust `@dexto/core` build (per‑file entries; bundle: false) to match subpaths
- [ ] Update CLI imports to use `@dexto/core` root + subpaths minimally (refactor away from aliases)
- [x] Verify Web UI imports only `@dexto/core` (no Node-only modules) — enforced via ESLint
- [ ] End-to-end build: core → cli → webui → copy → run

## Phase 5 — Optional: Extract `@dexto/server`
- [ ] Move API/server code (e.g., `src/app/api`, `src/app/web.ts`) → `src/packages/server/src`
- [ ] Expose server helpers; update CLI to consume them

## Docker & Runtime
- [ ] Update Dockerfile for monorepo build (simple or prune-based)
- [ ] Validate runtime: healthcheck, endpoints, CLI modes

## CI & Release
- [x] Add Changesets Version PR opener workflow
- [x] Add Changesets publisher workflow (version + build + publish)
- [x] Add "Require Changeset" PR guard (with maintainer override label)
- [x] Add Auto Changeset Action (Option A: auto-commit changeset based on labels)
- [ ] Add Slash Command (Option B) `/changeset patch|minor|major`
- [ ] Add One-click workflow (Option C) to add default patch changeset

## Lints & Typechecks
- [x] Root ESLint flat config; per-package overrides (Node, CLI, Next)
- [x] Root `tsconfig.base.json`; per-package `tsconfig.json` for core/cli; optional TS project references
- [ ] Align Vitest config per-package or shared; add root `test` script

## Documentation & Contributor Experience
- [ ] Update CONTRIBUTING for monorepo workflows and release requirements
- [x] Add PR template with release checklist and labels guidance
- [x] Update code and docs paths from src/app/* and src/core/* to new packages structure
- [ ] Document versioning model (lockstep → hybrid/independent path)

## Recent Changes (not originally listed)
- Added browser-safe logger shim and `package.json#browser` map to route `logger/index` → `logger/browser` in browser builds.
- Centralized LLM types/constants in `llm/types.ts`; updated registry and modules to consume from there; root re-exports types.
- Added `turbo` as devDependency and `packageManager` field; wired root `lint`/`typecheck` to Turbo; core + cli typecheck via Turbo.
- Added package-local ESLint config for Web UI and moved UI-specific rules there; root ESLint ignores Web UI.
- Enforced Web UI import policy: types-only + `toError` from `@dexto/core`; forbid `@core/*` to avoid Node deps in bundles.
- Root temporarily re-exports certain Node APIs (agent/config/utils/logger) to keep CLI imports simple during migration.

## Next Steps
1) CLI typecheck green without TS aliases
   - Replace `@core/*` alias imports with `@dexto/core` root (and minimal subpaths if needed).
   - Ensure `@dexto/core` root exports: DextoAgent, AgentCard, createAgentCard, loadAgentConfig, resolveBundledScript, logger, and LLM constants/types.
   - Add missing dev types in CLI: `@types/ws`, `type-fest` (done in package; install).
   - Confirm Turbo ordering: core build → cli typecheck.

2) Make core root strictly browser‑safe (after CLI refactor)
   - Remove Node-only re-exports from root; keep Node APIs on subpaths (logger/storage/config/path).
   - Keep the browser logger mapping as a guardrail.

3) Web UI
   - Keep UI runtime via API; imports from `@dexto/core` remain types-only + `toError`.
   - Optionally add a lightweight API endpoint for LLM registry if/when UI needs those helpers at runtime.

4) CI & Docs
   - Add slash-command or single-click changeset helpers.
   - Update CONTRIBUTING with monorepo workflows, Turbo commands, and required changesets.

5) Optional (later)
   - TS project references for core→cli to speed local typechecking, if we move away from subpath exports.
   - Consider a top-level `Dexto` orchestrator object + injectable logger (documented in `feature-plans/logger.md`).

## Future (Deferred) — Vite Migration
- [ ] Draft Vite SPA scaffold and static-serve integration
- [ ] Replace Next-only APIs; update copy/start logic to use `dist/`
- [ ] Decide timeline post-monorepo stabilization
