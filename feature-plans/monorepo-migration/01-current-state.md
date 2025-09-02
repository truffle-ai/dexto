# Current State Summary

- Single package with tsup bundling:
  - `src/core` → bundled to `dist/src/core` as CJS+ESM with d.ts.
  - `src/app` → bundled to `dist/src/app` as ESM.
- CLI entry: `bin.dexto → dist/src/app/index.js` with multiple modes/subcommands.
- Web UI: Next.js 15 in `src/app/webui` with its own package.json; built and copied to `dist/src/app/webui/.next/standalone` via `scripts/copy-webui-dist.ts`.
- Tests: Vitest. Linting: ESLint (flat). Formatting: Prettier. Hooks: Husky + lint-staged.
- Docker: multi-stage build runs `npm run build`, then `node dist/src/app/index.js --mode server`.

