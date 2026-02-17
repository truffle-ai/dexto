# Bun Migration (Package Manager + Runtime) — Functionality Parity

This folder tracks the plan and progress for migrating Dexto from pnpm/npm + Node to **Bun** (package manager **and** runtime) with **no feature/functionality changes** (PR 1).

Native TypeScript extension loading + layered `.dexto` / `~/.dexto` customization is explicitly split into a follow-up PR (see `PLAN.md`).

## Files

- `PLAN.md` — detailed plan + rationale
- `TASKLIST.md` — live checklist of all migration work
- `WORKING_MEMORY.md` — scratchpad + current status (update after completing tasks)

## Editing scope (owner request)

Until explicitly changed, only modify the files listed above while working on the Bun migration.
