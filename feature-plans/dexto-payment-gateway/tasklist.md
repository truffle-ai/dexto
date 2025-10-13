# Dexto Payment Gateway – Task List (Phased)

This task list tracks implementation of the Dexto gateway under `api.dexto.ai` and the corresponding CLI integration. It is organized into phases. See reference plans:

- 01-overview.md
- 02-repo-architecture.md
- 03-api-contracts.md
- 04-gateway-handlers.md
- 05-credits-tracking.md
- 06-cli-integration.md
- 07-test-plan.md
- 08-rollout.md

## Phase 0 — Decisions, Security, and Prep
- [ ] Confirm domain choice: `api.dexto.ai` (preferred) and version prefix `/v1`.
- [ ] Confirm OpenRouter BYOK behavior: per-user OR key minted with `include_byok_in_limit: true`; set `limit` to purchased credits; optional `limit_reset: monthly`.
- [ ] Define API auth policy: token-only Authorization on API; no cookies; strict CORS allowlist for `https://dexto.ai`.
- [ ] Inventory secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `OPENROUTER_PROVISIONING_KEY`, `STRIPE_*` (phase 2).
- [ ] Choose telemetry/logging stack (Vercel logs + optional PostHog/OTEL) and redaction rules.

## Phase 1 — Repo + Monorepo Setup (dexto-web)
- [ ] Create `dexto-web` monorepo layout: `apps/web`, `apps/api`, `packages/shared`.
- [ ] Set up two Vercel projects: `apps/web` (dexto.ai), `apps/api` (api.dexto.ai).
- [ ] Cloudflare DNS: add CNAME for `api.dexto.ai` → Vercel API project; set DNS-only.
- [ ] Move current serverless functions into `apps/api` Next.js Route Handlers.
- [ ] Establish shared zod schemas/DTOs in `packages/shared`.
- [ ] CI: build/test per app; protect main; add preview deployments.

## Phase 2 — Supabase Schema & Migrations
- [ ] Author SQL migrations under `apps/api/supabase/migrations/*.sql`:
  - [ ] `api_keys` (hashed `DEXTO_API_KEY`, status, scope, timestamps, RLS)
  - [ ] `balances` (credits_cents, RLS)
  - [ ] `usage_ledger` (model, token counts, cost_cents, ts, indexes, RLS)
  - [ ] (Existing) `openrouter_keys` encrypted storage confirmation
- [ ] Add RLS policies and service-role usage in server code.
- [ ] Local: apply via Supabase CLI; Prod: add CI step to apply migrations on merge to main.

## Phase 3 — Gateway API MVP (apps/api)
- [ ] `/api/provision` (Node runtime):
  - [ ] Verify Supabase session; resolve user.
  - [ ] Ensure per-user OR key exists; if missing, mint via OpenRouter with `include_byok_in_limit: true` and initial `limit`.
  - [ ] Issue (or return existing) `DEXTO_API_KEY` (hash stored; plaintext returned once).
  - [ ] Return `{ success, dextoApiKey, keyId, isNewKey }`.
  - [ ] Logging: no prompts/keys; structured minimal metadata.
- [ ] `/v1/chat/completions` (Edge runtime):
  - [ ] Auth by `DEXTO_API_KEY` (hashed lookup → user, wallet).
  - [ ] Optional rate-limits (token bucket).
  - [ ] Proxy to OpenRouter with `usage: { include: true }`; BYOK routing via `provider.order` when desired.
  - [ ] Read usage and compute `cost_cents`; decrement wallet atomically; insert ledger.
  - [ ] Streaming support; set headers `X-Dexto-Credits-Remaining`, `X-Dexto-Cost-Cents`.
  - [ ] Error handling: 402 guard, 429 rate-limit, upstream 5xx redacted.
- [ ] `/v1/models` (Edge runtime):
  - [ ] Return cached OpenRouter model list; periodic refresh.
- [ ] `/me/usage` (Node runtime):
  - [ ] Return `{ credits_cents, mtd_usage, recent }` for authorized users.
- [ ] `/api/keys/rotate` (Node) and `/api/openrouter-key/rotate` (Node):
  - [ ] Implement rotation flows; never return raw OR key.
- [ ] CORS middleware: allow `https://dexto.ai`; disallow cookies; preflight handling.

## Phase 4 — CLI Integration (dexto repo)
- [ ] Add `dexto` provider to `LLM_PROVIDERS`; treat as OpenAI-compatible with baseURL `https://api.dexto.ai/v1`.
- [ ] Update factory/router to support `dexto` seamlessly (similar to `openrouter`).
- [ ] `login-flow`: call `/api/provision`, persist `DEXTO_API_KEY`, write preferences with `provider: dexto`.
- [ ] Fallback logic: prefer `dexto` when `DEXTO_API_KEY` present; fallback to `openrouter` if not.
- [ ] Add `dexto billing status` command → calls `/me/usage`.
- [ ] Warnings: read `X-Dexto-Credits-Remaining` after requests.
- [ ] Update default config URL to `https://api.dexto.ai` once API is live.

## Phase 5 — Dashboard (apps/web)
- [ ] Supabase Auth login; dashboard scaffolding.
- [ ] Display `DEXTO_API_KEY` (create/rotate), balance, MTD usage, recent ledger.
- [ ] Model catalog link and per-user OR key status (`limit_remaining`, `usage_monthly`, `byok_usage_monthly`).
- [ ] Do not expose raw OR key.

## Phase 6 — Payments (Phase 2)
- [ ] Stripe Checkout for packs; webhook → `balances` crediting and `stripe_transactions` table.
- [ ] Intro credit for new users (optional).
- [ ] Later: subscriptions with `limit_reset: monthly`.

## Phase 7 — Observability & SLOs
- [ ] Rate limits (per-user) and guardrails.
- [ ] Metrics: latency, error rates, cost per request; alerts on anomalies.
- [ ] Logs: structured, secret-safe.

## Phase 8 — QA & Rollout
- [ ] Unit tests: auth, wallet atomic decrement, pricing map, rate-limit, redaction.
- [ ] Integration tests: `/api/provision`, `/v1/chat/completions` (200/402/429/5xx, streaming), `/v1/models`, `/me/usage`.
- [ ] Verify BYOK path decrements OR key `limit_remaining` (include_byok_in_limit).
- [ ] CLI E2E: `dexto login` → chat → headers warnings → `billing status`.
- [ ] Canary rollout; docs; release notes.

## Phase 9 — Migration & Future Work
- [ ] If ever moving from `dexto.ai/api` to `api.dexto.ai`, keep `/v1` stable; add redirects; switch dashboard to token-based API calls.
- [ ] Evaluate additional providers and model allowlist curation.
- [ ] Consider team wallets, invoices, exports, SLAs.

## Open Questions
- [ ] Public vs auth for `/v1/models`.
- [ ] Flat platform fee vs per-model markup.
- [ ] Region selection and cache strategy for models list.

