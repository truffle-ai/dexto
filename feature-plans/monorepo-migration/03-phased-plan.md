# Phased Plan

### Phase 0 — Prep and Baseline (no code moves)
- Document Node version (>=20) and enable `corepack`.
- Add root `preinstall: npx only-allow pnpm`.
- Confirm current `npm run build`, `test`, `lint` as baseline.

Deliverables: baseline checklist; no functional changes.
Status: Not started

---

### Phase 1 — Workspace Scaffolding (no code moves)
- Add `pnpm-workspace.yaml` targeting `src/packages/*`.
- Add root `package.json` (private) with devDependencies: `turbo`, `@changesets/cli`, eslint/prettier/ts types, vitest, tsup.
- Add `turbo.json` for `build`, `test`, `lint`, `typecheck`.
- Initialize Changesets.
- Add `tsconfig.base.json`.

Deliverables: root workspace + tooling in place; nothing moved yet.
Status: Not started

---

### Phase 2 — Package @dexto/core
- Move `src/core` → `src/packages/core/src`.
- Create `src/packages/core/package.json` with `name: "@dexto/core"` and tsup config (cjs+esm+dts).
- Keep `@core/*` alias during transition; add `@dexto/core: workspace:*` where consumed.
- Ensure Vitest/ESLint work in package and root.

Deliverables: `@dexto/core` builds independently.
Status: Not started

---

### Phase 3 — Package dexto (CLI)
- Move `src/app` → `src/packages/cli/src`.
- Create `src/packages/cli/package.json` with `name: "dexto"`, `bin: { "dexto": "dist/index.js" }`.
- Depend on `@dexto/core: workspace:*`.
- Keep `@core/*` alias or migrate to `@dexto/core` gradually.
- Move/copy `scripts/copy-webui-dist.ts` into `dexto` and update paths to copy webui standalone into `dexto/dist/webui`.
- Ensure `web` mode still spawns Next standalone server from copied artifacts.

Deliverables: `dexto` builds; CLI works in cli/web/server modes.
Status: Not started

---

### Phase 4 — Package @dexto/webui (keep Next.js)
- Move `src/app/webui` → `src/packages/webui`.
- Keep Next 15; enable clean imports from `@dexto/core` as needed (e.g., alias or `transpilePackages`).
- Update `dexto` build to run `pnpm -C src/packages/webui build` then copy `.next/standalone` via script.

Deliverables: `@dexto/webui` builds; CLI includes artifacts; behavior unchanged.
Status: Not started

---

### Phase 5 — Optional: Extract @dexto/server
- Move API/server code (e.g., `src/app/api`, `src/app/web.ts`) → `src/packages/server/src`.
- Expose server start helpers from `@dexto/server`; update CLI to consume them.

Deliverables: `@dexto/server` builds; cleaner boundaries.
Status: Not started

---

### Phase 6 — Docker and Runtime
- Note: confirm current docker file functionality before doing this. explain to user how current docker file works
- Update Dockerfile:
  - Simple: `pnpm -w i --frozen-lockfile && pnpm -w build`, copy `dexto/dist` and pruned node_modules.
  - Lean: `turbo prune --scope=dexto` and build from the pruned output.
- Confirm `CMD` launches server with correct ports/envs.

Deliverables: working Docker with monorepo.
Status: Not started

---

### Phase 7 — CI and Release
- CI jobs: `install`, `lint`, `typecheck`, `test`, `build`.
- Release: Changesets action opens Version PR; on merge, version+publish.
- Initialize lockstep versioning (see Versioning Strategy).

Deliverables: green CI; release flow produces versions/changelogs.
Status: Not started

---

### Phase 8 — Developer Ergonomics
- Add root scripts for targeted builds/tests; turbo filters.
- Enforce pnpm via `preinstall`.
- Update CONTRIBUTING with monorepo guidance.

Deliverables: smooth local dev.
Status: Not started

---

### Phase 9 — Future: Vite Migration (deferred)
- Optional swap of Next for Vite (Mastra-style) once monorepo stabilizes.
- Serve static UI from server; drop Next standalone.

Deliverables: tracked in separate plan later.
Status: Not started
