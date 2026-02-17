# Bun Migration (Package Manager + Runtime) — Functionality Parity

This folder tracks the plan and progress for migrating Dexto from pnpm/npm + Node to **Bun** (package manager **and** runtime) with **no feature/functionality changes** (PR 1).

Native TypeScript extension loading + layered `.dexto` / `~/.dexto` customization is explicitly split into a follow-up PR (see `PLAN.md`).

## Files

- `PLAN.md` — detailed plan + rationale
- `TASKLIST.md` — live checklist of all migration work
- `WORKING_MEMORY.md` — scratchpad + current status (update after completing tasks)

## Editing scope (owner request)

Keep the plan artifacts above updated as work progresses, and avoid unrelated repo churn. Code changes are expected as part of PR 1 (Bun migration with parity).
