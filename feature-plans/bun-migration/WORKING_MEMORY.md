# Working Memory — Bun Migration

> **This file is a live scratchpad for the Bun migration.**
> Update it after completing each task. Read it before starting any task.

---

## How to use this file

1. Before starting work: read **Current Task**, **Key Decisions**, and **Open Questions / Blockers**.
2. When starting a task: update **Current Task** with what you’re doing and how you’ll validate it.
3. While working: log findings and decisions in **Notes**.
4. After finishing: move the item to **Completed Tasks** and update **Checkpoint Log**.

---

## Current Task

**Task:** PR 1 / Phase 2 — functionality parity audit (and remaining cleanup)
**Status:** In progress
**Worktree:** `~/Projects/dexto-bun-migration`

### Plan
- Validate the repo is “Bun for everything” with no feature/functionality changes.
- Triage any remaining pnpm/npm touchpoints (primarily dev scripts) and decide whether they belong in PR 1.
- Validate parity with `bun run build`, `bun run typecheck`, `bun run test`.
- Keep `TASKLIST.md` + this file updated after each meaningful change.

### Notes
- Repo is pinned to Bun `1.3.5` (bumped to unlock `Bun.build({ compile: … })` for future binary shipping work).
- Plan artifacts committed to this worktree (commit `b40d68e2`).
- Checkpoint commit for Phase 0 + Phase 1 completed: `5ea80491`.
- Scope split (per discussion): **native TS `.dexto` layering** and **image-store redesign** are deferred to a follow-up PR (PR 2). PR 1 is Bun migration with **no feature/functionality changes**.
- Decision: **no runtime fallbacks**. Bun is required; no Bun→npm, Bun→Node fallback paths in Dexto runtime code.
- Scaffolding/template updates completed (commit `15352f74`):
  - `create-app` scaffold uses `bun src/index.ts` (no `tsx` dependency) and prints `bun run start`
  - `create-image` and generated READMEs print Bun commands (`bun run build`, `bun pm pack`, `bun publish`)
  - `init` prints `bun <path/to/file.ts>` instead of `npx tsx …`
  - `version-check` suggests `bun add -g dexto@latest` instead of `npm i -g dexto`
- Remaining pnpm/npm touchpoints (non-exhaustive, likely PR 1 candidates):
  - CLI flow parity outside `dexto-source` depends on publishing `@dexto/*` packages (owner will publish before merge)
  - Default MCP server templates/examples still use `npx` in some places (e.g. `agents/agent-template.yml`), which reintroduces an npm dependency.
  - If we switch `npx` → `bunx`, note that `bunx` can still spawn **Node** by default for packages whose bin shebang is `node` (use `bunx --bun` if we want “Bun runtime only” end-to-end).
  - Opencode reference for layered config + MCP:
    - It treats each discovered `.opencode/` directory (including `~/.opencode`) as a Bun package root and runs `bun add`/`bun install` to ensure dependencies are present.
    - It configures local MCP servers as a single `command: string[]` (cmd + args) and spawns them via `StdioClientTransport`.
  - Bun CLI nuance found during testing: `bun --cwd <dir> run <script>` prints Bun help instead of running the script; use `bun run --cwd <dir> <script>` (or `cd <dir> && bun run <script>`). This affected root scripts like `start`, `dev:cli`, and `build-webui` and has been fixed in root `package.json`.

Recent updates (commit `569253a5`):
- Removed remaining Bun→npm and Node runtime fallback paths:
  - CLI no longer falls back to npm for global installs (local models, image store, update command).
  - SQLite store is Bun-only (`bun:sqlite`; removed `better-sqlite3` fallback).
- Validation: `bun run build:cli`, `bun run test:unit`, `bun run lint` are green.

Recent updates (commit `3d6dbb1e`):
- `link-cli` now creates a Bun-global `dexto` shim by symlinking `packages/cli/dist/index.js` into `$(bun pm bin -g)`.
- `unlink-cli` removes the Bun-global shim and any Bun-global install.
- Validation: `bun run link-cli-fast`, `bun run unlink-cli` are green.

Recent updates (commit `ec3564ce`):
- GitHub Actions workflows migrated from pnpm/npm to Bun (CI + sync jobs + changesets release workflow)
- `changeset publish` replaced with Bun-based publishing (`scripts/publish-packages.ts`) because Changesets only supports npm/pnpm for publish
- Legacy pnpm files deleted (`pnpm-lock.yaml`, `pnpm-workspace.yaml`)
- Dev-only global install/link scripts moved off `npx`/`npm` fallbacks

Docs updates (commit `c6b670f7`):
- Docs site is Bun-based (`docs/bun.lock`) and `build-docs` workflow uses Bun.

Main sync (commit `f235a56a`):
- Merged refactor PR `#584` from `main` into this branch
- Resolved merge conflicts and validated with `bash scripts/quality-checks.sh all`

Merge blocker reminder:
- Parity sign-off for `dexto create-app/create-image/init` outside `dexto-source` is blocked on publishing `@dexto/*` packages (owner will publish before merge).

---

## Current State (as of 2026-02-18)

### What’s working under Bun

- Bun version in use: `1.3.5`
- Green commands:
  - `bun install --frozen-lockfile`
  - `bun install --save-text-lockfile`
  - `bun run build`
  - `bun run typecheck`
  - `bun run test`
  - `bun run test:unit`
  - `bun run lint`
  - `cd packages/cli && bun run start -- --help`

### Key repo changes already made (high level)

- Root workspace uses Bun (`packageManager`, `engines.bun`, `workspaces`, `bun.lock`).
- Repo scripts/entrypoints prefer `bun …` (no pnpm required for normal workflows).
- SQLite persistence under Bun uses `bun:sqlite` (removed `better-sqlite3`).
- Verified Bun can import TS sources that use NodeNext-style `.js` specifiers at runtime.

### Bun lifecycle scripts status

- `bun pm untrusted` currently reports blocked scripts for:
  - `core-js` (postinstall runs `node -e …`)
  - `protobufjs` (postinstall runs `node scripts/postinstall`)
- These have not been trusted; builds/tests still pass with them blocked.

---

## Key Decisions

- Split into PRs:
  - **PR 1:** Bun migration with functionality parity (this workstream)
  - **PR 2:** Native TS `.dexto` layering + extension loading and any image-store redesign
- Bun runtime is part of PR 1 (“Bun for everything”), but must preserve behavior.
- Prefer Bun built-ins over Node native add-ons where possible (e.g. SQLite via `bun:sqlite`).

---

## Open Questions / Blockers

1. **Local models:** `node-llama-cpp` installs and imports successfully under Bun `1.2.9` (validated in a temp project on macOS). Should re-validate under Bun `1.3.5`. Next validation is end-to-end local model execution (GGUF load + prompt).
2. **Repo dev scripts:** decide whether to keep `scripts/install-global-cli.ts` as-is (dev-only) or migrate it to `bunx`/Bun-first equivalents as part of PR 1.
3. **Image store future (PR 2):** keep and port to Bun, or replace with `~/.dexto` as a package root (preferred).
4. **Scaffolding + registry:** running `dexto create-app` outside `dexto-source` currently fails if `@dexto/*` packages aren’t available in the configured registry (observed 404 for `@dexto/storage` from the public npm registry). This is likely pre-existing; PR 1 should avoid changing this behavior, but we should document expectations.
5. **MCP “no npm” default:** should we update default agent templates to use Bun-first commands for MCP servers (`bunx …` or `bunx --bun …`)?

---

## Completed Tasks (log)

- 2026-02-17: Bun baseline working (`bun install`, build, typecheck, tests).
- 2026-02-17: Removed Bun runtime blocker `better-sqlite3` and implemented `bun:sqlite` path.
- 2026-02-17: Converted key repo scripts/entrypoints to use Bun.
- 2026-02-17: Added Bun migration plan artifacts under `feature-plans/bun-migration/` (commit `b40d68e2`).
- 2026-02-17: Checkpoint commit `5ea80491` (Bun runtime baseline + `bun.lock` + `bun:sqlite` + scripts/entrypoints).
- 2026-02-17: Image store installer now uses Bun (`bun pm pack` + `bun add`) instead of npm (commit `5e36ff3b`).
- 2026-02-17: Local model setup uses Bun to install `node-llama-cpp` into `~/.dexto/deps` (commit `ec32f68c`).
- 2026-02-17: Validated `bun add --trust node-llama-cpp` + `import('node-llama-cpp')` works under Bun `1.2.9` (macOS).
- 2026-02-17: Bun-first CLI scaffolding/templates + help text (commit `15352f74`).
- 2026-02-17: CI + release workflows migrated to Bun; remove pnpm lock/workspace; add Bun-based publish script (commit `ec3564ce`).
- 2026-02-17: Docs site migrated to Bun (`docs/bun.lock`, build workflow) (commit `c6b670f7`).
- 2026-02-17: Synced `main` into this branch; conflicts resolved; quality checks green (commit `f235a56a`).
- 2026-02-17: Fix root scripts to use correct Bun `--cwd` placement (`bun run --cwd …`) and `bun link` behavior (`cd … && bun link`) and validate `bun run start -- --help` + `bun run link-cli-fast`.
- 2026-02-17: Executed all root `package.json` scripts under Bun (skipped destructive Changesets scripts); fixed `bun run repo:test` failure caused by `@dexto/client-sdk` having no tests by adding `vitest run --passWithNoTests` (commit `dc3b79c2`).
- 2026-02-18: Removed remaining Bun→npm and Node runtime fallbacks (commit `569253a5`); validated with `bun run build:cli`, `bun run test:unit`, `bun run lint`.
- 2026-02-18: Fix `link-cli`/`unlink-cli` to create/remove a Bun-global shim for `dexto` (commit `3d6dbb1e`).
- 2026-02-18: Remove leftover example pnpm lockfiles (commit `8681cabd`).
- 2026-02-18: Fix Node/Vitest loader incompatibility with `bun:sqlite` by lazy-loading it at runtime (commit `9309e5e6`).
- 2026-02-18: Bump Bun to `1.3.5` in repo config + CI workflows; full `bash scripts/quality-checks.sh all` is green (commit `b807d437`).

---

## Checkpoint Log

| Date | Checkpoint | Result | Notes |
|------|------------|--------|------|
| 2026-02-17 | Bun baseline | ✅ | build/typecheck/test green under Bun `1.2.9` |
| 2026-02-17 | Phase 0 + 1 checkpoint | ✅ | Commit `5ea80491`; validated with `bun run build`, `bun run typecheck`, `bun run test` |
| 2026-02-17 | Bun-first scaffolding/templates | ✅ | Commit `15352f74`; validated with `bun run build`, `bun run typecheck`, `bun run test` |
| 2026-02-17 | CI + release on Bun | ✅ | Commit `ec3564ce`; workflows migrated; publish uses Bun script; pnpm files deleted |
| 2026-02-17 | Docs on Bun | ✅ | Commit `c6b670f7`; `docs/` uses Bun; `build-docs` workflow updated |
| 2026-02-17 | Main sync | ✅ | Commit `f235a56a`; conflicts resolved; `bash scripts/quality-checks.sh all` green |
| 2026-02-18 | No npm/node fallbacks | ✅ | Commit `569253a5`; validated with `bun run build:cli`, `bun run test:unit`, `bun run lint` |
| 2026-02-18 | Bun `1.3.5` bump | ✅ | Commits `9309e5e6` + `b807d437`; `bash scripts/quality-checks.sh all` green |
