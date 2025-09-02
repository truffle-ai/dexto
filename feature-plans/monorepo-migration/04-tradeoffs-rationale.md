# Tradeoffs & Rationale

## Next Standalone (current) vs Mastra-Style (static UI from CLI)
- Next Standalone (keep now):
  - Pros: No UI rewrite; full Next features; clean separation as `@dexto/webui`.
  - Cons: Heavier runtime/Docker; more complex build/start; larger CLI artifact if bundling UI.
- Mastra-Style (later optional):
  - Pros: One server process; lighter runtime; faster dev; smaller artifact.
  - Cons: Requires Vite/SPA migration; no SSR.

Choice: keep Next standalone during migration; revisit Vite if UI stays “playground-only”.

## Server Package Split
- Single package (CLI owns server): fewer packages but mixed concerns.
- Split (`@dexto/server`): clearer boundaries, independent server usage; slightly more package overhead.

Choice: start without split; optionally extract server in Phase 5.

## Dependency Strategy
- Internal deps via `workspace:*` (e.g., `@dexto/core`).
- Root holds toolchain devDeps only; each package declares runtime deps explicitly.
- For Next, use alias or `transpilePackages` if needed.

