# Target Structure & Tooling

## Target Monorepo Structure
```
root
├─ pnpm-workspace.yaml
├─ turbo.json
├─ .changeset/
├─ tsconfig.base.json
└─ src/packages/
   ├─ core/        (@dexto/core)
   ├─ cli/         (dexto)       ← ships the CLI bin
   ├─ webui/       (@dexto/webui)← Next.js app (kept as-is initially)
   └─ server/      (@dexto/server)← optional extraction of API layer (Phase 4+)
```

Notes:
- Migrate in phases: core → cli → webui; optionally extract server afterward.
- Retain Next standalone initially; copy its build artifacts into `dexto` at build time.

## Tooling Decisions
- Package manager: pnpm workspaces (speed, workspace protocol, deterministic lockfile).
- Orchestration: Turborepo (graph, caching, filters).
- Versioning: Changesets (start with lockstep across primary packages).
- Build: tsup per-package.
- Testing: Vitest per-package; aggregate with turbo/pnpm filters.

