# Acceptance, Rollback, Next Steps

## Acceptance Criteria
- `pnpm -w build` produces the same runnable CLI and server behavior as before.
- `dexto` works in `cli`, `web`, and `server` modes; web mode serves the Next UI as before.
- Vitest and ESLint run from root and per-package; no regressions.
- Docker image builds and runs; healthcheck passes; endpoints work.
- Changesets Version PR opens; lockstep versions bump correctly.

## Rollback Plan
- Phased movement allows partial rollbacks (e.g., keep webui in place while core/cli are already packaged).
- Keep a branch per phase; if validation fails, revert that phase and continue on the previous stable state.

## Next Steps
- Proceed with Phase 1 (workspace scaffolding), then Phase 2–4 migrations.
- Schedule the Vite migration plan after the monorepo stabilizes.

