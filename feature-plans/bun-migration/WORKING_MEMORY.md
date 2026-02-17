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
- Repo is pinned to Bun `1.2.9` (intentionally; no need to bump during migration).
- Plan artifacts committed to this worktree (commit `b40d68e2`).
- Checkpoint commit for Phase 0 + Phase 1 completed: `5ea80491`.
- Scope split (per discussion): **native TS `.dexto` layering** and **image-store redesign** are deferred to a follow-up PR (PR 2). PR 1 is Bun migration with **no feature/functionality changes**.
- Scaffolding/template updates completed (commit `15352f74`):
  - `create-app` scaffold uses `bun src/index.ts` (no `tsx` dependency) and prints `bun run start`
  - `create-image` and generated READMEs print Bun commands (`bun run build`, `bun pm pack`, `bun publish`)
  - `init` prints `bun <path/to/file.ts>` instead of `npx tsx …`
  - `version-check` suggests `bun add -g dexto@latest` instead of `npm i -g dexto`
- Remaining pnpm/npm touchpoints (non-exhaustive, likely PR 1 candidates):
  - CLI flow parity outside `dexto-source` depends on publishing `@dexto/*` packages (owner will publish before merge)

Recent updates (commit pending at time of writing):
- GitHub Actions workflows migrated from pnpm/npm to Bun (CI + sync jobs + changesets release workflow)
- `changeset publish` replaced with Bun-based publishing (`scripts/publish-packages.ts`) because Changesets only supports npm/pnpm for publish
- Legacy pnpm files deleted (`pnpm-lock.yaml`, `pnpm-workspace.yaml`)
- Dev-only global install/link scripts moved off `npx`/`npm` fallbacks

---

## Current State (as of 2026-02-17)

### What’s working under Bun

- Bun version in use: `1.2.9`
- Green commands:
  - `bun install --frozen-lockfile`
  - `bun install --save-text-lockfile`
  - `bun run build`
  - `bun run typecheck`
  - `bun run test`
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

1. **Local models:** `node-llama-cpp` installs and imports successfully under Bun `1.2.9` (validated in a temp project on macOS). Next validation is end-to-end local model execution (GGUF load + prompt).
2. **Repo dev scripts:** decide whether to keep `scripts/install-global-cli.ts` as-is (dev-only) or migrate it to `bunx`/Bun-first equivalents as part of PR 1.
3. **Image store future (PR 2):** keep and port to Bun, or replace with `~/.dexto` as a package root (preferred).
4. **Scaffolding + registry:** running `dexto create-app` outside `dexto-source` currently fails if `@dexto/*` packages aren’t available in the configured registry (observed 404 for `@dexto/storage` from the public npm registry). This is likely pre-existing; PR 1 should avoid changing this behavior, but we should document expectations.

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
- 2026-02-17: CI + release workflows migrated to Bun; remove pnpm lock/workspace; add Bun-based publish script (commit pending).

---

## Checkpoint Log

| Date | Checkpoint | Result | Notes |
|------|------------|--------|------|
| 2026-02-17 | Bun baseline | ✅ | build/typecheck/test green under Bun `1.2.9` |
| 2026-02-17 | Phase 0 + 1 checkpoint | ✅ | Commit `5ea80491`; validated with `bun run build`, `bun run typecheck`, `bun run test` |
| 2026-02-17 | Bun-first scaffolding/templates | ✅ | Commit `15352f74`; validated with `bun run build`, `bun run typecheck`, `bun run test` |
