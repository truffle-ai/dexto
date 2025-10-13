# Repo & Deployment Architecture (Proposal)

## Current
- `../functions`: serverless functions deployed to a separate Vercel project/host.
- `../dexto-lp`: Landing site deployed to `dexto.ai`.
- CLI points to `packages/cli/package.json:config.dexto_api_url` (currently an external host).

## Proposal (Minimal churn)
- Move `../functions` into the `dexto-lp` repo and rename the repo to `dexto-web`.
  - Keep a single Vercel monorepo project with two surfaces:
    - Web app (Next.js): `https://dexto.ai` (marketing + dashboard + login)
    - API/gateway (Edge/Serverless functions): `https://api.dexto.ai` (preferred) or `/api` under the same project
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
 6. Add Supabase tables (api_keys, balances, usage), keep `openrouter_keys` as-is (encrypted, per-user upstream).

## Monorepo Structure (dexto-web)
```
apps/
  web/                 # Next.js app: marketing site + dashboard (dexto.ai)
  api/                 # Next.js app (route handlers) for API/gateway (api.dexto.ai)
packages/
  shared/              # Shared types/utils (zod schemas, dto, constants)

# Optional: infra and migrations
infra/
  vercel/              # vercel.json / project configs if needed
  cloudflare/          # notes / IaC for DNS records (manual if preferred)
apps/api/supabase/
  migrations/          # SQL migrations checked in to git
  seed/                # optional seed SQL
```
Notes:
- Each subdirectory (`apps/web`, `apps/api`) is linked to its own Vercel project.
- `packages/shared` contains code shared by both apps (avoid duplicating types and constants).

### Functions to migrate
- `openrouter-provision` → becomes `/api/openrouter-provision` (for BYOK provisioning) and/or merged into a new `/api/auth/*` flow.
  - When minting per-user OpenRouter keys, set `include_byok_in_limit: true`, initialize `limit` to purchased credits, and optionally `limit_reset: monthly` for subscriptions.
- New endpoints (paid gateway):
  - `/v1/chat/completions` (OpenAI-compatible proxy)
  - `/v1/models` (model list; cached)
- `/me/usage` (credits + MTD usage)

### Runtime selection per endpoint
- Edge runtime (`export const runtime = 'edge'`):
  - Low-latency, global, great for streaming. Limited Node APIs.
  - Use for: `/v1/chat/completions` proxy (SSE/Web streams), `/v1/models` (if only fetching cached JSON).
- Node runtime (`export const runtime = 'nodejs'`):
  - Full Node APIs, libraries, and long-lived connections. Slightly higher latency.
  - Use for: `/api/provision` (Supabase admin + encryption), Stripe webhooks, `/me/usage` (DB lookups/aggregation), key rotation endpoints.

### DNS & Hosting
- Domain registrar/DNS: Cloudflare.
  - Create CNAME records for `dexto.ai` (apex via flattening or custom setup per Vercel docs) and `api.dexto.ai` pointing to Vercel-provided domains.
  - Set records to "DNS only" (not proxied) to avoid issues with Vercel SSL.
- Hosting: Vercel.
  - Link monorepo with two projects: one rooted at `apps/web`, one at `apps/api`.
  - Attach `dexto.ai` to the web project; attach `api.dexto.ai` to the API project.
  - Configure environment variables separately for each project (Supabase keys, OpenRouter provisioning key, Stripe, encryption keys).

### Key handling
- BYOK path (OpenRouter): keep storing per-user OpenRouter keys (encrypted) as implemented today; these keys are returned to users only on the BYOK flow.
- Dexto gateway path (paid): prefer per-user OpenRouter keys stored server-side and never returned to clients; gateway selects the user key for upstream calls. Alternatively, use a pooled org key for MVP if time-constrained.

### DEXTO_API_KEY storage
- Generate cryptographically secure random keys; store only hashed (e.g., SHA-256) in `api_keys` with user_id, scope, status, created_at.
- Show plaintext once on creation (dashboard/CLI); subsequent reads only return metadata.
- Expose rotate/revoke endpoints; revoke marks key inactive and logs out sessions if desired.

## Website login
- Add “Sign in” on `dexto.ai` (Supabase Auth). Store session JWT in httpOnly cookie.
- Show a Dashboard page:
  - Copy/paste `DEXTO_API_KEY` (rotate/revoke)
  - Credits balance, usage (chart), top-up button
- Model catalog link (OpenRouter-sourced)
- Per-user OpenRouter key status (exists/rotated/limit); never show raw key value for managed `dexto` path.
  - Show `limit_remaining`, `usage_monthly`, and `byok_usage_monthly` (queried by server from OpenRouter) to mirror “OpenRouter credits” UX.

## Analytics
- Tag requests by provider (`dexto`, `openrouter`, native providers) and router (`vercel`, `in-built`).
- Keep gateway logs secret-safe: userId, keyId, model, token counts, cost, latency.

## Database migrations (Supabase)
- Keep SQL migrations in `apps/api/supabase/migrations/*.sql` and commit them to git.
- Local/dev: use Supabase CLI to generate/apply migrations; prod: run a CI step (GitHub Action) to apply migrations on merge to main.
- Keep schema idempotent (`IF NOT EXISTS`) where possible; version with timestamps, e.g., `20251013_add_usage_ledger.sql`.
