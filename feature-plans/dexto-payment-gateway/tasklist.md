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

## 🎯 Current Status (Updated 2025-10-14)

**✅ Infrastructure Complete:**
- Monorepo created (`dexto-web`)
- Database schema deployed to production
- API deployed to `api.dexto.ai`
- CLI login provisions DEXTO_API_KEY

**🔄 In Progress:**
- Phase 3: CORS, key rotation endpoints
- Phase 4: Remove OpenRouter commands, add Dexto-branded commands

**⏸️ Blocked:**
- Phase 5 (Dashboard): Waiting on `dexto-lp` → `dexto-web/apps/web` migration

**⚠️ CRITICAL NEXT STEPS:**
1. **Test production APIs** - Verify `/api/provision`, `/v1/chat/completions`, `/me/usage` work end-to-end
2. **Remove OpenRouter commands** - Clean up CLI to hide infrastructure from users
3. **Add Dexto-branded CLI commands** - `dexto keys`, `dexto billing`, credit warnings
4. **Migrate landing page** - Move `dexto-lp` to unblock dashboard development

## Phase 0 — Decisions, Security, and Prep
- [x] Confirm domain choice: `api.dexto.ai` (preferred) and version prefix `/v1`.
- [x] Confirm OpenRouter BYOK behavior: per-user OR key minted with `include_byok_in_limit: true`; set `limit` to $10 initial; optional `limit_reset: monthly`.
- [x] Define API auth policy: token-only Authorization on API; no cookies; strict CORS allowlist for `https://dexto.ai`.
- [x] Inventory secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `OPENROUTER_PROVISIONING_KEY`, `STRIPE_*` (phase 2).
- [x] Choose telemetry/logging stack: Structured JSON logging; redact all prompts/keys.

## Phase 1 — Repo + Monorepo Setup (dexto-web) 🔄 MOSTLY COMPLETED
- [x] Create `dexto-web` monorepo layout: `apps/web`, `apps/api`, `packages/shared`.
- [x] Turborepo + pnpm workspaces configured
- [x] Move current serverless functions into `apps/api` Next.js Route Handlers.
- [x] Establish shared zod schemas/DTOs in `packages/shared` (constants, types, schemas).
- [x] Set up Vercel project for `apps/api` (api.dexto.ai) - deployed and live.
- [x] Cloudflare DNS: add CNAME for `api.dexto.ai` → Vercel API project.
- [ ] Migrate `dexto-lp` landing page into `dexto-web/apps/web` (currently separate repo).
- [ ] Set up Vercel project for `apps/web` (dexto.ai) once migration complete.
- [ ] CI: build/test per app; protect main; add preview deployments.

## Phase 2 — Supabase Schema & Migrations ✅ COMPLETED
- [x] Author SQL migrations under `supabase/migrations/*.sql`:
  - [x] `api_keys` (SHA-256 hashed `DEXTO_API_KEY`, status, scope, timestamps)
  - [x] `balances` (credits_cents with 1000 cents ($10) default, version for optimistic locking)
  - [x] `usage_ledger` (model, token counts, cost_cents, ts, indexes, JSONB metadata)
  - [x] `openrouter_keys` (internal only, confirmed with `include_byok_in_limit: true`, never exposed to users)
  - [x] RPC functions: `decrement_balance()` and `get_user_usage_summary()`
- [x] Applied to production via `supabase db push`.
- [x] Local testing setup with modular seed data.
- [x] **RLS policies configured and tested:**
  - [x] `openrouter_keys` - NO user access policies (service role only)
  - [x] `api_keys` - Users can SELECT own keys (no writes)
  - [x] `balances` - Users can SELECT own balance (no writes)
  - [x] `usage_ledger` - Users can SELECT own usage history (no writes)
  - [x] Tested user isolation (users can't see each other's data)
  - [x] Tested write protection (users can't INSERT/UPDATE/DELETE)
- [ ] CI: add step to apply migrations on merge to main (future automation).

## Phase 3 — Gateway API MVP (apps/api) 🔄 MOSTLY COMPLETED
- [x] `/api/provision` (Node runtime):
  - [x] Verify Supabase session; resolve user (JWT bearer token required).
  - [x] Ensure per-user OR key exists; if missing, mint via OpenRouter with `include_byok_in_limit: true` and initial `limit: 10`.
  - [x] Issue new `DEXTO_API_KEY` (SHA-256 hash stored; plaintext returned once).
  - [x] Initialize balance with 1000 cents ($10) for new users.
  - [x] Return `{ success, dextoApiKey, keyId, isNewKey }`.
  - [x] Logging: no prompts/keys; structured minimal metadata.
- [x] `/v1/chat/completions` (Node runtime):
  - [x] Auth by `DEXTO_API_KEY` (hashed lookup → user, wallet).
  - [x] Proxy to OpenRouter with per-user internal key; forward usage data.
  - [x] Read usage and compute `cost_cents`; decrement wallet atomically via RPC.
  - [x] Insert usage_ledger entry.
  - [x] Set headers `X-Dexto-Credits-Remaining`, `X-Dexto-Cost-Cents`, `X-Dexto-Request-ID`.
  - [x] Error handling: 402 if insufficient funds, 401 for auth, 500 for upstream errors.
  - [x] **Streaming support** (implemented with SSE and post-stream billing).
- [x] `/v1/models` (Edge runtime):
  - [x] Return cached OpenRouter model list with 1-hour cache.
  - [x] Public endpoint (no auth required).
- [x] `/me/usage` (Node runtime):
  - [x] Return `{ credits_cents, mtd_usage, recent }`.
  - [x] Auth by `DEXTO_API_KEY`.
- [ ] **TODO: `/api/keys/rotate`** - Rotate user's DEXTO_API_KEY (JWT or API key auth).
- [ ] **TODO: `/api/openrouter-key/rotate`** - Admin-only internal endpoint (low priority).
- [ ] **TODO: CORS middleware** - Allow `https://dexto.ai` for dashboard (needed for Phase 5).
- [ ] Rate-limits (token bucket) - defer to Phase 7.

## Phase 4 — CLI Integration (dexto repo) 🔄 MOSTLY COMPLETED
- [x] Add `dexto` provider to `LLM_PROVIDERS`; treat as OpenAI-compatible with baseURL `https://api.dexto.ai/v1`.
- [x] Update factory/router to support `dexto` seamlessly.
- [x] `dexto login` flow: OAuth → call `/api/provision` → persist `DEXTO_API_KEY` → write preferences with `provider: dexto`.
- [x] Remove legacy OpenRouter provisioning fallback in login.
- [x] CLI points to `https://api.dexto.ai` by default.
- [ ] **TODO: Remove OpenRouter POC commands** (white-label approach, hide infrastructure):
  - [ ] Remove `dexto openrouter status` (exposes OpenRouter to users)
  - [ ] Remove `dexto openrouter regenerate` (exposes OpenRouter to users)
  - [ ] Rebrand `dexto openrouter models` → `dexto models` (calls `/v1/models`)
- [ ] **TODO: Add new Dexto-branded commands**:
  - [ ] `dexto keys list` - List user's DEXTO_API_KEYs
  - [ ] `dexto keys rotate` - Rotate DEXTO_API_KEY (calls `/api/keys/rotate`)
  - [ ] `dexto billing status` - Show credits and usage (calls `/me/usage`)
  - [ ] `dexto billing history` - Show recent usage (calls `/me/usage?detailed=true`)
- [ ] **TODO: Add credit warnings after requests**:
  - [ ] Read `X-Dexto-Credits-Remaining` header from responses
  - [ ] Warn when balance < $1 (100 cents)
  - [ ] Show warning: "Low balance: $X.XX remaining. Top up at https://dexto.ai/billing"

## Phase 5 — Dashboard (apps/web) ⏸️ BLOCKED
**Prerequisite:** Migrate `dexto-lp` landing page to `dexto-web/apps/web` first (Phase 1 task).

Once landing page is migrated:
- [ ] Add Supabase Auth login/signup flow.
- [ ] Dashboard scaffolding (protected routes, layout).
- [ ] **API Keys page**:
  - [ ] List user's DEXTO_API_KEYs (created_at, last_used_at, status).
  - [ ] Create new DEXTO_API_KEY button (calls `/api/provision`).
  - [ ] Rotate key button (calls `/api/keys/rotate`).
  - [ ] Revoke key button.
- [ ] **Billing page**:
  - [ ] Display current balance (credits_cents).
  - [ ] MTD usage summary (total_requests, total_cost_cents, total_tokens).
  - [ ] Recent usage history table (timestamp, model, tokens, cost).
  - [ ] "Top Up" button (links to Stripe - Phase 6).
- [ ] **Models page** (optional):
  - [ ] Display available models from `/v1/models`.
  - [ ] Pricing information per model.
- [ ] **IMPORTANT: Never expose raw OpenRouter key** - it's internal infrastructure.

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
