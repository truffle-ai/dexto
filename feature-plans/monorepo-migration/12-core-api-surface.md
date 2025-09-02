# Core API Surface: Browser‑Safe Root + Two Node Subpaths

Goal
- Make `@dexto/core` safe to import from the Web UI (browser bundle) while keeping Node‑only code available to CLI/server via explicit subpaths.
- Public surfaces:
  - `@dexto/core` (browser‑safe)
  - `@dexto/core/logger` (Node‑only)
  - `@dexto/core/storage` (Node‑only)

Why
- Browser bundles can’t include Node built‑ins (fs, path, dns) or native addons (e.g., better‑sqlite3). If the core root re‑exports modules that import these, Webpack resolves them and fails.
- Keeping Node‑only modules off the root export ensures Web UI builds cleanly.

What’s Node‑Only Today
- Storage backends: better‑sqlite3 (native), pg, ioredis, plus fs usage in backends and storage manager.
- Logger: fs, path, winston.
- Config loaders/writers/resolvers: fs.
- Utilities: path/env/execution‑context use fs/path.
- Agent registry: fs.

Plan Summary
- Root (`@dexto/core`) should export only browser‑safe modules (types, registries, schemas, non‑I/O utils).
- Add two subpaths (no more):
  - `@dexto/core/logger` → logger public API.
  - `@dexto/core/storage` → storage manager + backends public API (if exported at all).
- Update CLI to import `@dexto/core/logger` (and storage if needed). Web UI imports `@dexto/core` only.

Implementation Steps (No Code Yet)
1) Core package exports
- Curate `src/packages/core/src/index.ts` to re‑export only browser‑safe modules.
- Ensure `src/packages/core/src/logger/index.ts` and `src/packages/core/src/storage/index.ts` export public APIs for those subpaths (no transitive Node surprises).
- In `src/packages/core/package.json`, add subpath exports:
  - `"./logger"`: `"./dist/logger/index.js"` + types
  - `"./storage"`: `"./dist/storage/index.js"` + types
- Keep `"."` → `"./dist/index.*"` (browser‑safe surface).

2) Core build (tsup)
- Preferred: per‑file outputs for explicit mapping (simplest to reason about):
  - `entry: { index: 'src/index.ts' }`, `bundle: false`, `format: ['cjs','esm']`, `outDir: 'dist'`, `dts: true`.
  - Emits `dist/<folder>/index.js` for subpaths.
- Alternative: multi‑entry bundling (optional):
  - `entry: { index: 'src/index.ts', logger: 'src/logger/index.ts', storage: 'src/storage/index.ts' }`, `bundle: true`.
  - Produces `dist/logger.js`, `dist/storage.js` and adjust exports accordingly.
- Keep CJS+ESM for Node consumers; we are not removing CJS.

3) Update consumers
- Web UI: import `@dexto/core` only (browser‑safe by design).
- CLI/Server: import `@dexto/core/logger` for logging; `@dexto/core/storage` if used directly.

4) Clean up
- Remove any Node‑only exports from the root barrel.
- Verify that root does not pull: storage, logger, config I/O, fs/path/env/execution‑context, better‑sqlite3/pg/redis.

5) Verification
- Build order: core → cli (root tsup) → webui → copy.
- Web UI: `pnpm -C src/packages/webui build` does not resolve fs/dns/native addons.
- CLI: `pnpm start` server/web modes still work.
- Tests: `pnpm test` green.

Backward Compatibility
- Breaking: root no longer re‑exports logger/storage. Internal imports updated; external users (if any) must switch to `@dexto/core/logger` or `@dexto/core/storage`.
- Document in CHANGELOG when releasing.

Rollout Notes
- Start with per‑file outputs (bundle: false) to make subpath exports unambiguous and easy to verify.
- Later, switch to multi‑entry bundling if desired without changing the public surface.

