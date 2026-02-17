# Bun Migration Tasklist (Live)

Update this checklist as work completes. Keep tasks concrete and verifiable.

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
- [x] Decide Bun version policy: keep pin at `1.2.9` (don’t chase latest during migration)
- [ ] Remove/replace remaining hardcoded `pnpm`/`npm` usage in CLI output/help text
- [ ] Update CLI scaffolding and templates to prefer `bun` (install/run/build instructions)
- [ ] Replace `npx`/`npm` usage in repo dev scripts with `bunx`/`bun` where possible (e.g. `scripts/install-global-cli.ts`)
- [x] Migrate image-store installer off `npm pack` + `npm install` to Bun equivalents
- [ ] Revisit “local model” dependency install (`node-llama-cpp` currently installed via `npm`)
- [ ] Decide what to do with legacy pnpm files (`pnpm-lock.yaml`, `pnpm-workspace.yaml`) once CI flips
- [x] Checkpoint commit: Phase 1 SQLite + runtime blockers removed

## Phase 2 — Native TS extensions in layered `.dexto` roots (DEXTO_DOTDEXTO intent)

- [ ] Define extension roots (`~/.dexto`, `<project>/.dexto`, repo dev root) + precedence rules
- [ ] Make `~/.dexto` a Bun package root (`package.json` + `node_modules`)
- [ ] Implement resolver/import strategy for extensions using Bun APIs (e.g. `Bun.resolveSync`)
- [ ] Validate “drop-in TS module” import under Bun runtime (no build step)
- [ ] Define stable TS extension interfaces for: images, plugins, storage, compaction, hooks

## Phase 3 — Deprecate/redesign the image store

- [ ] Decide: keep image store (Bun-based) vs replace with `~/.dexto` package-root installs
- [ ] If replacing: design migration path from existing `~/.dexto/images` registry to `~/.dexto/package.json` deps
- [ ] If keeping: implement Bun-native pack/install strategy and confirm multi-version support story

## Phase 4 — CI + docs

- [ ] Update CI to use Bun for install/build/typecheck/test
- [ ] Update docs (DEVELOPMENT/CONTRIBUTING) from pnpm/npm to Bun commands
- [ ] Document Bun lifecycle scripts policy (`trustedDependencies`, `bun pm untrusted`, `bun pm trust`)
