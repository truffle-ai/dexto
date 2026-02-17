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

**Task:** Commit plan artifacts to this worktree
**Status:** In progress
**Worktree:** `~/Projects/dexto-bun-migration`

### Plan
- Backfill plan/tasklist/memory with what’s already completed in the worktree.
- Commit the plan artifacts (they live under `feature-plans/`, which is gitignored for new files).

### Notes
- Repo is currently pinned to Bun `1.2.9` and is building/typechecking/testing successfully under Bun.

---

## Current State (as of 2026-02-17)

### What’s working under Bun

- Bun version in use: `1.2.9`
- Green commands:
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

- **Bun runtime is required** (not just Bun-as-package-manager) to support “native TS in `~/.dexto`” without a loader.
- Prefer Bun built-ins over Node native add-ons where possible (e.g. SQLite via `bun:sqlite`).
- Treat `~/.dexto` layering as the long-term replacement for the current “image store” shape (aligns with DEXTO_DOTDEXTO intent).

---

## Open Questions / Blockers

1. **Bun version policy:** repo is pinned to `1.2.9`, but latest stable is newer (see PLAN). When do we bump?
2. **Local models:** `node-llama-cpp` is installed via `npm` into `~/.dexto/deps`. Under Bun runtime, native add-ons may be ABI-sensitive. Decide whether to:
   - keep Node for this feature only,
   - switch to an alternative runtime strategy (ollama / external process),
   - or ensure Bun-compatible Node-API builds.
3. **Image store future:** keep and port to Bun, or replace with `~/.dexto` as a package root (preferred).

---

## Completed Tasks (log)

- 2026-02-17: Bun baseline working (`bun install`, build, typecheck, tests).
- 2026-02-17: Removed Bun runtime blocker `better-sqlite3` and implemented `bun:sqlite` path.
- 2026-02-17: Converted key repo scripts/entrypoints to use Bun.

---

## Checkpoint Log

| Date | Checkpoint | Result | Notes |
|------|------------|--------|------|
| 2026-02-17 | Bun baseline | ✅ | build/typecheck/test green under Bun `1.2.9` |

