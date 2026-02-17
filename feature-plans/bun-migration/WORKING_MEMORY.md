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

**Task:** Phase 1.5 — remove pnpm/npm assumptions (image store + local models + scaffolding)
**Status:** In progress
**Worktree:** `~/Projects/dexto-bun-migration`

### Plan
- Triage remaining pnpm/npm touchpoints (installers, scaffolding, docs/UX strings) and convert them to Bun-first behavior.
- Keep `TASKLIST.md` + this file updated after each meaningful change.

### Notes
- Repo is pinned to Bun `1.2.9` (intentionally; no need to bump during migration).
- Plan artifacts committed to this worktree (commit `b40d68e2`).
- Checkpoint commit for Phase 0 + Phase 1 completed: `5ea80491`.
- Remaining pnpm/npm touchpoints (non-exhaustive, starting points):
  - `packages/cli/src/cli/utils/image-store.ts` — migrated to Bun (`bun pm pack` + `bun add`), but still needs broader image-store vs `~/.dexto` layering decision
  - `packages/cli/src/cli/utils/local-model-setup.ts` — migrated to `bun add --trust node-llama-cpp` (install+import validated under Bun `1.2.9`; still needs E2E GGUF execution validation)
  - `packages/cli/src/cli/ink-cli/components/overlays/custom-model-wizard/LocalModelWizard.tsx` — migrated to Bun (still needs E2E GGUF execution validation)
  - `packages/cli/src/cli/utils/scaffolding-utils.ts` — uses `npm init -y`, then chooses `pnpm`/`npm` for deps
  - `packages/cli/src/cli/utils/package-mgmt.ts` — detects `pnpm-lock.yaml` and defaults to `npm` (needs `bun` support)
  - `scripts/install-global-cli.ts` — uses `npx verdaccio …` and `npm uninstall -g …` for a local install simulation
  - `packages/registry/src/mcp/server-registry-data.json` + related docs — many MCP presets default to `npx` (consider `bunx` if we want “no npm” end-to-end)

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

1. **Local models:** `node-llama-cpp` installs and imports successfully under Bun `1.2.9` (validated in a temp project on macOS). Next validation is end-to-end local model execution (GGUF load + prompt).
2. **Image store future:** keep and port to Bun, or replace with `~/.dexto` as a package root (preferred).

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

---

## Checkpoint Log

| Date | Checkpoint | Result | Notes |
|------|------------|--------|------|
| 2026-02-17 | Bun baseline | ✅ | build/typecheck/test green under Bun `1.2.9` |
| 2026-02-17 | Phase 0 + 1 checkpoint | ✅ | Commit `5ea80491`; validated with `bun run build`, `bun run typecheck`, `bun run test` |
