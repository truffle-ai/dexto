# Bun Migration Tasklist (Live)

Update this checklist as work completes. Keep tasks concrete and verifiable.

## PR 1 — Bun migration (functionality parity)

Success criteria:
- Replace pnpm with Bun (package manager + runtime) without feature/functionality changes.
- Ensure `npm i -g dexto` works without requiring Bun installed (npm wrapper + prebuilt binaries).
- Keep native TS `.dexto` layering work as a separate PR.

## Phase 0 — Working Bun baseline (monorepo)

- [x] Add Bun lockfile (`bun.lock`) and make `bun install` succeed from clean checkout
- [x] Pin Bun via root `package.json#packageManager` and `engines.bun`
- [x] Ensure workspaces declared in root `package.json` (Bun workspaces)
- [x] Convert repo scripts to Bun (`bun run …`, `bun x …`) for day-to-day workflows
- [x] Convert CLI + bundler entrypoints to Bun runtime (shebangs / start scripts)
- [x] Confirm `bun run build`, `bun run typecheck`, `bun run test` are green
- [x] Checkpoint commit: Phase 0 baseline (Bun scripts + lockfile)

## Phase 1 — Native dependencies + “no pnpm/npm” cleanup

- [x] Remove the primary Bun runtime blocker (`better-sqlite3`) from runtime dependency paths
- [x] Implement Bun-native SQLite store path using `bun:sqlite`
- [x] Decide Bun version policy: pin at `1.3.5` (stable + supports `Bun.build({ compile: … })`)
- [x] Remove/replace remaining hardcoded `pnpm`/`npm` usage in CLI output/help text
- [x] Update CLI scaffolding and templates to prefer `bun` (install/run/build instructions)
- [x] Replace `npx`/`npm` usage in repo dev scripts with `bun` where possible (e.g. `scripts/install-global-cli.ts`)
- [x] Migrate image-store installer off `npm pack` + `npm install` to Bun equivalents
- [ ] Local model deps: ensure the `node-llama-cpp` install flow works when `dexto` is installed via npm wrapper (no external Bun prerequisite)
- [x] Make `bun:sqlite` Node-import safe (lazy-load at runtime) so `vitest` can run under Node
- [x] Remove remaining `better-sqlite3`/Node-addon runtime blockers in core paths (Bun runtime)
- [x] Delete legacy pnpm files (`pnpm-lock.yaml`, `pnpm-workspace.yaml`)
- [x] Checkpoint commit: Phase 1 SQLite + runtime blockers removed

## Phase 2 — Functionality parity audit (no feature changes)

- [x] Confirm `bun install`, `bun run build`, `bun run typecheck`, `bun run test`
- [x] Verify all root `package.json` scripts run under Bun (skip destructive/publishing scripts like `changeset:version` / `changeset:publish`)
- [x] Migrate GitHub Actions workflows from pnpm/npm to Bun (CI + sync jobs)
- [x] Migrate release workflow to Bun (Changesets versioning + Bun-based publish)
- [x] Convert docs site (Docusaurus) to Bun (`docs/bun.lock`, workflow)
- [x] Add npm wrapper + platform binary packages so end users don’t need Bun installed
- [ ] Release workflow: build platform binaries before publishing (`changeset:publish`)
- [ ] Local production-like install: update `bun run install-cli(-fast)` to build binaries (at least `--single`) before publishing to verdaccio
- [ ] Remove remaining npm usage from default MCP server templates (at minimum `agents/agent-template.yml`): switch `npx` → `bunx` (decide whether to add `--bun`) and validate filesystem + playwright MCP servers still start.
- [ ] Confirm CLI flows work and print Bun-first instructions (note: app/image scaffolds may require access to the `@dexto/*` registry when run outside `dexto-source`):
  - `dexto create-app`
  - `dexto create-image`
  - `dexto init`
- [ ] Confirm image install flows work without npm/pnpm:
  - linked install from a local directory
  - tarball install produced via `bun pm pack`
- [ ] Checkpoint commit: PR 1 parity working state

## PR 2 (deferred) — Native TS `.dexto` layering + extension system

- [ ] Define extension roots (`~/.dexto`, `<project>/.dexto`, repo dev root) + precedence rules
- [ ] Make `~/.dexto` a Bun package root (`package.json` + `node_modules`)
- [ ] Implement resolver/import strategy for extensions using Bun APIs (e.g. `Bun.resolveSync`)
- [ ] Validate “drop-in TS module” import under Bun runtime (no build step)
- [ ] Define stable TS extension interfaces for: images, plugins, storage, compaction, hooks

## PR 2 (deferred) — Deprecate/redesign the image store

- [ ] Decide: keep image store (Bun-based) vs replace with `~/.dexto` package-root installs
- [ ] If replacing: design migration path from existing `~/.dexto/images` registry to `~/.dexto/package.json` deps
- [ ] If keeping: implement Bun-native pack/install strategy and confirm multi-version support story

## PR 3 (deferred) — CI + docs

- [ ] Update docs (DEVELOPMENT/CONTRIBUTING) from pnpm/npm to Bun commands
- [ ] Document Bun lifecycle scripts policy (`trustedDependencies`, `bun pm untrusted`, `bun pm trust`)
