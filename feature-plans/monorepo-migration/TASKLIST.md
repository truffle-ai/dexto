# Monorepo Migration Tasklist (Live)

Track progress here. Update checkboxes as tasks complete.

## Global Setup
- [ ] Enforce pnpm via root `preinstall: npx only-allow pnpm`
- [x] Add `pnpm-workspace.yaml` (targets `src/packages/*`)
- [x] Add `turbo.json` (build/test/lint/typecheck pipelines, outputs)
- [x] Add `tsconfig.base.json`
- [x] Initialize Changesets (`.changeset/`), configure fixed group for lockstep
- [ ] Add root scripts: `build`, `test`, `lint`, `typecheck`

## Phase 2 — Package `@dexto/core`
- [ ] Move `src/core` → `src/packages/core/src`
- [ ] Create `src/packages/core/package.json` (exports, types) and tsup config
- [ ] Keep `@core/*` alias (temp) and add `@dexto/core: workspace:*` where consumed
- [ ] Typecheck/lint/test `@dexto/core` package

## Phase 3 — Package `dexto` (CLI)
- [ ] Move `src/app` → `src/packages/cli/src`
- [ ] Create `src/packages/cli/package.json` (`name: dexto`, `bin: { dexto: dist/index.js }`)
- [ ] Migrate/adjust tsup config for CLI build
- [ ] Move/copy `scripts/copy-webui-dist.ts` into `dexto` and update paths
- [ ] Verify `dexto` works: cli, web, server modes

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
- [ ] Add Changesets Version PR opener workflow
- [ ] Add Changesets publisher workflow (version + build + publish)
- [ ] Add "Require Changeset" PR guard (with maintainer override label)
- [ ] Add Auto Changeset Action (Option A: auto-commit changeset based on labels)
- [ ] Add Slash Command (Option B) `/changeset patch|minor|major`
- [ ] Add One-click workflow (Option C) to add default patch changeset

## Lints & Typechecks
- [ ] Root ESLint flat config; per-package overrides (Node, CLI, Next)
- [ ] Root `tsconfig.base.json`; per-package `tsconfig.json`; optional TS project references
- [ ] Align Vitest config per-package or shared; add root `test` script

## Documentation & Contributor Experience
- [ ] Update CONTRIBUTING for monorepo workflows and release requirements
- [ ] Add PR template with release checklist and labels guidance
- [ ] Document versioning model (lockstep → hybrid/independent path)

## Future (Deferred) — Vite Migration
- [ ] Draft Vite SPA scaffold and static-serve integration
- [ ] Replace Next-only APIs; update copy/start logic to use `dist/`
- [ ] Decide timeline post-monorepo stabilization
