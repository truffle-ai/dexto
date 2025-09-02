# Docker, Runtime & CI

## Docker
- Simple: `pnpm -w install --frozen-lockfile && pnpm -w build`, then copy only `dexto/dist` and pruned `node_modules`.
- Lean: `turbo prune --scope=dexto` and build from the pruned output for minimal size.
- Ensure `.dexto` data path is writable.

## Runtime
- CLI `web` mode should continue to spawn the Next standalone server from the copied artifacts.
- Optional future: serve Vite static assets from server (Mastra-style) once migrated.

## CI
- Jobs: `install`, `lint`, `typecheck`, `test`, `build` at root using turbo.
- Release: Changesets Version PR opener + publisher workflows.
- Add “Require Changeset” guard to enforce changeset presence for publishable changes (with maintainer override label).

