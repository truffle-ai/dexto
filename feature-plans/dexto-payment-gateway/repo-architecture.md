# Repo & Deployment Architecture (Proposal)

## Current
- `../functions`: serverless functions deployed to a separate Vercel project/host.
- `../dexto-lp`: Landing site deployed to `dexto.ai`.
- CLI points to `packages/cli/package.json:config.dexto_api_url` (currently an external host).

## Proposal (Minimal churn)
- Move `../functions` into the `dexto-lp` repo and rename the repo to `dexto-web`.
  - Keep a single Vercel monorepo project with two surfaces:
    - Web app (Next.js): `https://dexto.ai` (marketing + dashboard + login)
    - API/gateway (Edge/Serverless functions): `https://api.dexto.ai` or `/api` under the same project
  - Add Vercel project settings to map `api.dexto.ai` to the functions entrypoint (or use Next.js `app/api/*`).
- Keep the CLI repo separate (`dexto`) to avoid heavy coupling; it talks to `api.dexto.ai` for login/provisioning and billing.

## Routing choices
- Option A (clean): dedicate `api.dexto.ai` for gateway + auth callbacks.
- Option B (simple): host under `dexto.ai/api/*` and update CLI baseURL to `https://dexto.ai/api`.

## Migration Plan
1. Create `apps/web` (existing landing) and `apps/api` (functions) inside `dexto-web`.
2. Add Supabase client and the existing OAuth callback endpoints into `apps/api`.
3. Configure DNS: `api.dexto.ai` → Vercel project, route to API entry.
4. Switch CLI `dexto_api_url` to `https://api.dexto.ai`.
5. Keep the old host alive; add 307 redirects to the new host for `/api/*` until all clients update.

## Website login
- Add “Sign in” on `dexto.ai` (Supabase Auth). Store session JWT in httpOnly cookie.
- Show a Dashboard page:
  - Copy/paste `DEXTO_API_KEY` (rotate/revoke)
  - Credits balance, usage (chart), top-up button
  - Model catalog link (OpenRouter-sourced)

## Analytics
- Tag requests by provider (`dexto`, `openrouter`, native providers) and router (`vercel`, `in-built`).
- Keep gateway logs secret-safe: userId, keyId, model, token counts, cost, latency.
