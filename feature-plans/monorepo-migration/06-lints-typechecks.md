# Lints & Typechecks

Recommended: centralized configs at root with per-package overrides only where needed.

## ESLint
- Single root `eslint.config.js` (flat config) shared across repo.
- Overrides:
  - `@dexto/core`, `@dexto/server`: Node/ESM rules.
  - `dexto` (CLI): Node/ESM; relax console rules as needed.
  - `@dexto/webui`: React/DOM; Next plugin via root override for `src/packages/webui/**` or a tiny local config extending root.
- Run: `pnpm -w lint` (turbo caches per package).

## TypeScript
- Root `tsconfig.base.json` with common options.
- Each package `tsconfig.json` extends base; set `include`, `outDir`, optionally `composite: true`.
- Option A: per-package `tsc --noEmit` for typecheck.
- Option B: TS project references; root `tsconfig.build.json` with `references`; run `tsc -b`.
- Run: `turbo run typecheck` or `tsc -b`.

## Vitest
- Per-package `vitest.config.ts` or a root config extended in packages.
- Run: `pnpm -w test` (turbo) or `pnpm -r test`.

## Prettier
- Single root config; run `pnpm -w prettier:check/format`.

Why centralized?
- Consistency, less duplication, easier upgrades; only add per-package configs for framework-specific needs.

