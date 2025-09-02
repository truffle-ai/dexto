# Future: Vite Migration (Deferred)

We’ll consider replacing Next with a Vite SPA once monorepo is stable.

## Why
- Simpler runtime (single server), smaller artifacts, faster dev builds.

## Impact
- Replace Next-specific APIs: `next/link`, `next/image`, `next/font`, `next/headers` → SPA equivalents.
- Proxy `/api` via Vite dev server; static asset serve from server in prod.
- Update copy/start logic to handle `dist/` instead of `.next/standalone`.

## Difficulty
- Low–moderate. Your app uses mostly client-side features; few Next-only dependencies.

