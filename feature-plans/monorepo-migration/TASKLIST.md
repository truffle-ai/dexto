# Monorepo Migration Tasklist (Live)

Track progress here. Update checkboxes as tasks complete.

## Global Setup
- [ ] Enforce pnpm via root `preinstall: npx only-allow pnpm`
- [x] Add `pnpm-workspace.yaml` (targets `src/packages/*`)
- [x] Add `turbo.json` (build/test/lint/typecheck pipelines, outputs)
- [x] Add `tsconfig.base.json`
- [x] Initialize Changesets (`.changeset/`), configure fixed group for lockstep
- [x] Add root scripts: repo-level turbo scripts (`repo:build`, `repo:test`, `repo:lint`, `repo:typecheck`)

## Phase 2 — Package `@dexto/core`
- [x] Move `src/core` → `src/packages/core/src`
- [x] Create `src/packages/core/package.json` (exports, types). Use root tsup for now.
- [x] Update path aliases to `@core/*` → `src/packages/core/src/*` (root, vitest, next/webui)
- [x] Add per-package tsup config
- [ ] Typecheck/lint/test `@dexto/core` package (package-level)

## Phase 3 — Package `dexto` (CLI)
- [x] Move `src/app` → `src/packages/cli/src`
- [x] Create `src/packages/cli/package.json` (`type: module`, scripts)
- [x] Migrate/adjust tsup config for CLI build
- [x] Update copy script paths (kept at root; optional move into `dexto` later)
- [ ] Verify `dexto` works: cli, web, server modes
- [x] Add per-package tsup/tsconfig for CLI

## Phase 4 — Package `@dexto/webui` (Next.js)
- [ ] Move `src/app/webui` → `src/packages/webui`
- [ ] Ensure webui build works; update alias/transpile if needed
- [ ] Update `dexto` build to run webui build and copy `.next/standalone`

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
- [ ] Root ESLint flat config; per-package overrides (Node, CLI, Next)
- [x] Root `tsconfig.base.json`; per-package `tsconfig.json` for core/cli; optional TS project references
- [ ] Align Vitest config per-package or shared; add root `test` script

## Documentation & Contributor Experience
- [ ] Update CONTRIBUTING for monorepo workflows and release requirements
- [x] Add PR template with release checklist and labels guidance
- [x] Update code and docs paths from src/app/* and src/core/* to new packages structure
- [ ] Document versioning model (lockstep → hybrid/independent path)

## Future (Deferred) — Vite Migration
- [ ] Draft Vite SPA scaffold and static-serve integration
- [ ] Replace Next-only APIs; update copy/start logic to use `dist/`
- [ ] Decide timeline post-monorepo stabilization
