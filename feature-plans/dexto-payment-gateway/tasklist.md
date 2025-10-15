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

## 🎯 Current Status (Updated 2025-10-15)

**✅ Infrastructure Complete:**
- ✅ Monorepo created (`dexto-web`) with Turborepo + pnpm workspaces
- ✅ Database schema deployed to production (comprehensive with RPC functions)
- ✅ API deployed to `api.dexto.ai` and fully operational
- ✅ CLI login provisions DEXTO_API_KEY successfully
- ✅ Streaming support working with `after()` async billing
- ✅ All core API endpoints implemented and tested

**🔄 In Progress:**
- Phase 4: CLI user-facing commands (billing, keys, credit warnings)
- Phase 5: Dashboard development (blocked on landing page migration)

**⏸️ Blocked:**
- Phase 5 (Dashboard): Waiting on `dexto-lp` → `dexto-web/apps/web` migration
- Phase 6 (Payments): Stripe integration not yet started

**⚠️ CRITICAL NEXT STEPS:**
1. **Add CLI billing commands** - `dexto billing status`, `dexto billing history`
2. **Add CLI key commands** - `dexto keys list`, `dexto keys rotate`
3. **Add credit warnings** - Display balance warnings after API calls
4. **Migrate landing page** - Move `dexto-lp` to unblock dashboard development
5. **Stripe integration** - Enable credit top-ups

**📊 Implementation Progress:**
- Core Infrastructure: 95% ✅
- API Layer: 100% ✅
- CLI Integration: 60% 🔄
- Dashboard: 0% ⏸️
- Payments: 0% ⏸️

---

## Phase 0 — Decisions, Security, and Prep ✅ COMPLETED
- [x] Confirm domain choice: `api.dexto.ai` (preferred) and version prefix `/v1`.
- [x] Confirm OpenRouter BYOK behavior: per-user OR key minted with `include_byok_in_limit: true`; set `limit` to $10 initial; optional `limit_reset: monthly`.
- [x] Define API auth policy: token-only Authorization on API; no cookies; strict CORS allowlist for `https://dexto.ai`.
- [x] Inventory secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `OPENROUTER_PROVISIONING_KEY`, `STRIPE_*` (phase 2).
- [x] Choose telemetry/logging stack: Structured JSON logging; redact all prompts/keys.

---

## Phase 1 — Repo + Monorepo Setup (dexto-web) ✅ MOSTLY COMPLETED
- [x] Create `dexto-web` monorepo layout: `apps/web`, `apps/api`, `packages/shared`.
- [x] Turborepo + pnpm workspaces configured
- [x] Move current serverless functions into `apps/api` Next.js Route Handlers.
- [x] Establish shared zod schemas/DTOs in `packages/shared` (constants, types, schemas).
- [x] Set up Vercel project for `apps/api` (api.dexto.ai) - deployed and live.
- [x] Cloudflare DNS: add CNAME for `api.dexto.ai` → Vercel API project.
- [ ] **TODO: Migrate `dexto-lp` landing page** into `dexto-web/apps/web` (currently separate repo).
- [ ] **TODO: Set up Vercel project** for `apps/web` (dexto.ai) once migration complete.
- [ ] **TODO: CI setup**: build/test per app; protect main; add preview deployments.

---

## Phase 2 — Supabase Schema & Migrations ✅ COMPLETED

### Database Schema Deployed (Production Ready)

**Tables:**
- [x] `api_keys` - SHA-256 hashed `DEXTO_API_KEY`, status, scope, key_display, timestamps
  - Unique index on user_id for active keys
  - RLS policies: users can SELECT own keys only
- [x] `balances` - credits_usd (decimal), version for optimistic locking, auto-creates with $10 default
  - RLS policies: users can SELECT own balance only
- [x] `usage_ledger` - comprehensive usage tracking with model, tokens, cost_usd, session_id, JSONB metadata
  - Indexed by user_id + timestamp for fast queries
  - Foreign key to api_keys
  - RLS policies: users can SELECT own usage only
- [x] `openrouter_keys` - encrypted per-user OpenRouter keys (internal only, never exposed to users)
  - Spending limit tracking
  - RLS policies: NO user access (service role only)

**RPC Functions (All Deployed):**
- [x] `get_api_key_context(p_key_hash)` - Validate DEXTO_API_KEY and get user context + balance (auto-creates balance if missing)
- [x] `log_chat_usage()` - Atomic usage logging + balance decrement with optimistic locking
- [x] `decrement_balance(p_user_id, p_amount_usd)` - Safe balance decrement with version check
- [x] `get_user_usage_summary(p_user_id, p_start_date, p_end_date, p_recent_limit)` - Aggregated usage statistics

**Migration Management:**
- [x] Applied to production via `supabase db push`
- [x] Local testing setup with modular seed data
- [x] RLS policies configured and tested for user isolation
- [x] All write operations restricted to service role
- [ ] **TODO: CI automation** to apply migrations on merge to main

**Schema Improvements Over Original Plan:**
- ✅ Changed from cents to USD decimals for better precision
- ✅ Added session_id tracking in usage_ledger
- ✅ Added key_display field for UX (showing last 4 chars)
- ✅ Added comprehensive RPC functions for atomic operations
- ✅ Auto-creates balance with $10 default for new users

---

## Phase 3 — Gateway API MVP (apps/api) ✅ COMPLETED

All endpoints implemented, tested, and deployed to production:

### Authentication & Provisioning
- [x] **`POST /api/provision`** (Node runtime):
  - ✅ Verifies Supabase session JWT bearer token
  - ✅ Ensures per-user OR key exists; mints if missing with `include_byok_in_limit: true` and $10 limit
  - ✅ Issues new `DEXTO_API_KEY` (SHA-256 hash stored; plaintext returned once)
  - ✅ Initializes balance with $10 for new users (via RPC auto-create)
  - ✅ Returns `{ success, dextoApiKey, keyId, isNewKey }`
  - ✅ Structured logging (no prompts/keys leaked)
  - ✅ KV cache integration for performance

### Core LLM Gateway
- [x] **`POST /v1/chat/completions`** (Edge runtime):
  - ✅ Auth by `DEXTO_API_KEY` (hashed lookup → user, wallet via RPC)
  - ✅ KV cache for API key context (reduces DB round-trips)
  - ✅ Proxy to OpenRouter with per-user internal key
  - ✅ **Streaming support** with SSE format (`data: {...}\n\n`)
  - ✅ **Post-stream billing** using Next.js 15's `after()` API (non-blocking to client)
  - ✅ Compute cost from OpenRouter response (BYOK upstream costs)
  - ✅ Atomic balance decrement via `log_chat_usage` RPC
  - ✅ Response headers: `X-Dexto-Credits-Remaining`, `X-Dexto-Cost-USD`, `X-Dexto-Request-ID`
  - ✅ Error handling: 402 insufficient funds, 401 auth failure, 500 upstream errors
  - ✅ Comprehensive timing metrics logged (TTFB, last chunk, done sent, billing duration)
  - ✅ OpenRouter cost field parsing (BYOK vs non-BYOK)
  - ⚠️ **Known Issue**: `after()` keeps HTTP connection open during billing (~500ms delay) - acceptable trade-off for billing reliability

### Models & Usage
- [x] **`GET /v1/models`** (Edge runtime):
  - ✅ Returns cached OpenRouter model list
  - ✅ 1-hour cache duration
  - ✅ Public endpoint (no auth required)
  - ✅ Deployed and accessible

- [x] **`GET /me/usage`** (Node runtime):
  - ✅ Returns `{ balance, total_cost, total_requests, by_model, recent }`
  - ✅ Auth by `DEXTO_API_KEY`
  - ✅ Calls `get_user_usage_summary` RPC
  - ✅ Deployed and working

### Key Management
- [x] **`POST /keys/rotate`** (Node runtime):
  - ✅ Rotate user's DEXTO_API_KEY
  - ✅ JWT or API key auth supported
  - ✅ Revokes old key, issues new
  - ✅ Returns new key once

- [x] **`GET /keys/validate`** (Edge runtime):
  - ✅ Validate DEXTO_API_KEY is active
  - ✅ Returns `{ valid: boolean }`
  - ✅ Used by CLI for key validation

### Performance Optimizations
- [x] **Upstash Redis KV Cache**:
  - ✅ API key context caching (reduces DB lookups)
  - ✅ OpenRouter key caching (avoids repeated decryption)
  - ✅ Balance caching (updated on each transaction)
  - ✅ Cache hit/miss logging for observability

### TODO (Low Priority)
- [ ] **`POST /api/openrouter-key/rotate`** - Admin-only internal endpoint (not needed for MVP)
- [ ] **CORS middleware** - Allow `https://dexto.ai` for dashboard (Phase 5 dependency)
- [ ] **Rate-limits** (token bucket per user) - defer to Phase 7

---

## Phase 4 — CLI Integration (dexto repo) 🔄 60% COMPLETED

### Core Integration ✅ COMPLETED
- [x] Add `dexto` provider to `LLM_PROVIDERS` registry; treat as OpenAI-compatible
- [x] Auto-inject baseURL `https://api.dexto.ai/v1` when `provider === 'dexto'`
- [x] Update factory/router to support `dexto` seamlessly (uses Vercel AI SDK)
- [x] `dexto login` flow: OAuth → call `/api/provision` → persist `DEXTO_API_KEY` → write preferences
- [x] Remove legacy OpenRouter provisioning fallback in login
- [x] CLI points to `https://api.dexto.ai` by default
- [x] DextoApiClient utility for key management (`validateDextoApiKey`, `rotateDextoApiKey`)
- [x] Model validation using OpenRouter models cache (treats `dexto` provider like OpenRouter)

### TODO: User-Facing Commands 🚨 HIGH PRIORITY

#### Remove OpenRouter POC Commands (White-Label Approach)
The goal is to hide infrastructure details from users. OpenRouter is an internal implementation detail.

- [ ] **Remove `dexto openrouter status`** - Exposes OpenRouter to users (confusing)
- [ ] **Remove `dexto openrouter regenerate`** - Exposes OpenRouter to users
- [ ] **Rebrand `dexto openrouter models` → `dexto models`** - Calls `/v1/models`, no mention of OpenRouter

#### Add Dexto-Branded Commands

**Key Management:**
- [ ] **`dexto keys list`** - List user's DEXTO_API_KEYs
  - Show created_at, last_used_at, status, key_display
  - Call `/keys/list` (needs new endpoint) or use auth token to query Supabase directly
- [ ] **`dexto keys rotate`** - Rotate DEXTO_API_KEY
  - Calls existing `/keys/rotate` endpoint
  - Updates local .env/.dexto/config

**Billing & Usage:**
- [ ] **`dexto billing status`** - Show current balance and MTD summary
  - Calls existing `/me/usage` endpoint
  - Display: current balance, total requests this month, total cost, top models
- [ ] **`dexto billing history`** - Show recent usage history
  - Calls `/me/usage?detailed=true` or new endpoint
  - Table format: timestamp, model, tokens, cost

**Credit Warnings (Passive UX):**
- [ ] **Read `X-Dexto-Credits-Remaining` header** after each LLM request
- [ ] **Warn when balance < $1.00**:
  - Message: `⚠️  Low balance: $X.XX remaining. Top up at https://dexto.ai/billing`
  - Only show once per session to avoid spam
- [ ] **Error handling for 402 responses**:
  - Catch 402 from `/v1/chat/completions`
  - Display friendly message: `Insufficient credits ($X.XX remaining). Top up at https://dexto.ai/billing`

### TODO: Documentation
- [ ] **Update README** with `dexto` provider usage examples
- [ ] **Document `dexto login` flow** for new users
- [ ] **Add billing commands to CLI help** text

---

## Phase 5 — Dashboard (apps/web) ⏸️ BLOCKED (0% Complete)

**Prerequisite:** Migrate `dexto-lp` landing page to `dexto-web/apps/web` first (Phase 1 task).

### Once Landing Page Migrated:

#### Authentication
- [ ] Add Supabase Auth login/signup flow (reuse from dexto-lp)
- [ ] Dashboard scaffolding (protected routes, layout)
- [ ] User profile page (email, created_at)

#### API Keys Page
- [ ] **List API keys table**:
  - Columns: Key (display last 4), Created, Last Used, Status
  - Data source: Query Supabase `api_keys` table (RLS ensures user isolation)
- [ ] **Create new API key button**:
  - Calls `/api/provision` with auth token
  - Shows new key ONCE in modal (security best practice)
- [ ] **Rotate key button**:
  - Calls `/keys/rotate` with auth token
  - Shows new key ONCE; revokes old key
- [ ] **Revoke key button**:
  - Updates `api_keys.status = 'revoked'`
  - Confirmation dialog

#### Billing Page
- [ ] **Current balance card**:
  - Display `balances.credits_usd` with 2 decimal places
  - Color-code: green ($10+), yellow ($1-$10), red (<$1)
- [ ] **MTD usage summary**:
  - Total requests, total cost, total tokens
  - Data source: Call `/me/usage` API
- [ ] **Usage by model chart**:
  - Pie/bar chart showing cost breakdown by model
  - Use `by_model` field from `/me/usage` response
- [ ] **Recent usage history table**:
  - Columns: Timestamp, Model, Tokens (in/out), Cost
  - Data source: `recent` array from `/me/usage`
  - Pagination for >100 entries
- [ ] **"Top Up" button**:
  - Links to Stripe Checkout (Phase 6)
  - Disabled until Stripe integration complete

#### Models Page (Optional)
- [ ] **Available models list**:
  - Fetch from `/v1/models`
  - Display: model ID, provider, context length
- [ ] **Pricing information**:
  - Per-model input/output token costs
  - Data source: OpenRouter pricing (cached)

#### Critical: Security
- [ ] **NEVER expose raw OpenRouter key** in dashboard UI or API responses
  - OpenRouter keys are internal infrastructure only
  - Only show DEXTO_API_KEY (with last 4 chars for identification)

---

## Phase 6 — Payments (Stripe Integration) ⏸️ NOT STARTED (0% Complete)

### Stripe Setup
- [ ] Create Stripe account + get API keys (test + live)
- [ ] Add Stripe secrets to Vercel environment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- [ ] Install `stripe` npm package in `apps/api`

### Checkout Flow
- [ ] **`POST /api/stripe/create-checkout-session`**:
  - Create Stripe Checkout Session for credit packs ($5, $10, $25, $50, $100)
  - Store pending transaction in `stripe_transactions` table (status: pending)
  - Return `sessionUrl` to redirect user
- [ ] **Dashboard integration**:
  - "Top Up" button creates checkout session
  - Redirect to Stripe hosted checkout
  - Return URL: `https://dexto.ai/billing?session_id={CHECKOUT_SESSION_ID}`

### Webhook Handler
- [ ] **`POST /api/stripe/webhook`**:
  - Verify webhook signature using `STRIPE_WEBHOOK_SECRET`
  - Handle `checkout.session.completed` event:
    - Extract `amount_total` and convert to USD
    - Call `decrement_balance` RPC with negative amount (to add credits)
    - Update `stripe_transactions` table (status: completed)
    - Log transaction details
  - Handle `checkout.session.expired` event:
    - Update `stripe_transactions` (status: failed)

### Database Schema Updates
- [ ] **Create `stripe_transactions` table**:
  - id (UUID), user_id (FK), amount_usd, status (pending/completed/failed)
  - stripe_session_id, stripe_payment_intent_id
  - created_at, completed_at
  - RLS: users can SELECT own transactions

### Intro Credits (Optional)
- [ ] **Auto-credit new users**:
  - Detect first login in `/api/provision`
  - Call `decrement_balance(user_id, -1.00)` to add $1 free credit
  - Log in `stripe_transactions` with type: 'intro_credit'

### Subscriptions (Phase 2 - Future)
- [ ] Stripe Subscriptions for monthly credits
- [ ] Set `limit_reset: monthly` on OpenRouter keys
- [ ] Handle `subscription.created`, `subscription.deleted` webhooks

---

## Phase 7 — Observability & SLOs ⏸️ NOT STARTED

### Rate Limiting
- [ ] **Per-user rate limits**:
  - Use Upstash Redis for token bucket implementation
  - Default: 60 requests/minute per user
  - Burst: 10 requests
  - Return `429 Too Many Requests` with `Retry-After` header
- [ ] **Global rate limits** (abuse protection):
  - 10,000 requests/minute across all users
  - Alert if threshold exceeded

### Metrics & Monitoring
- [ ] **Vercel Analytics** integration:
  - Track API endpoint latencies
  - Track error rates by endpoint
- [ ] **Custom metrics** (Upstash Analytics or similar):
  - Cost per request (p50, p95, p99)
  - Tokens per request
  - Cache hit rates
  - OpenRouter upstream latency
- [ ] **Alerts**:
  - Balance going negative (billing bug)
  - Error rate >5%
  - P95 latency >2s
  - Cache hit rate <50%

### Logging Improvements
- [ ] **Structured logging** (already done, but enhance):
  - Add request_id to all logs
  - Add user_id to all logs (hashed for privacy)
  - Never log prompts, API keys, or PII
- [ ] **Log retention** policy:
  - Vercel: 7 days (free tier)
  - Consider external logging (Axiom, Datadog) for longer retention

### SLAs & Reliability
- [ ] Define SLAs:
  - 99.9% uptime
  - P95 latency <500ms (excluding OpenRouter)
- [ ] Circuit breaker for OpenRouter failures
- [ ] Fallback provider if OpenRouter is down (future)

---

## Phase 8 — QA & Rollout ⏸️ NOT STARTED

### Testing
- [ ] **Unit tests**:
  - Auth middleware (DEXTO_API_KEY validation)
  - Wallet atomic decrement (optimistic locking)
  - Pricing map (cost calculation logic)
  - Rate-limit logic (token bucket)
  - Redaction (ensure no secrets leaked in logs)
- [ ] **Integration tests**:
  - `/api/provision` (200, 401, new user flow)
  - `/v1/chat/completions` (200 streaming, 200 non-streaming, 402 insufficient funds, 429 rate limit, 5xx upstream errors)
  - `/v1/models` (200, caching behavior)
  - `/me/usage` (200, aggregation correctness)
- [ ] **E2E tests (CLI)**:
  - `dexto login` → chat → verify headers → `billing status`
  - Low balance warning triggers
  - 402 error handling
- [ ] **Load testing**:
  - 100 concurrent users
  - Verify no race conditions in balance decrement
  - Verify cache performance under load

### Rollout Plan
- [ ] **Beta testing** (10-20 users):
  - Invite early adopters
  - Monitor logs for errors
  - Collect feedback on UX
- [ ] **Canary rollout** (1% traffic):
  - Deploy to production
  - Monitor metrics for 24 hours
  - Compare error rates vs baseline
- [ ] **Full rollout** (100% traffic):
  - Announce on Discord, Twitter
  - Update docs
  - Release notes

### Documentation
- [ ] **User docs** (in dexto repo README):
  - Quick start with `dexto login`
  - Pricing table (per model)
  - Billing FAQ
  - BYOK vs Dexto Credits comparison
- [ ] **API docs** (OpenAPI spec):
  - Document all `/v1/*` endpoints
  - Document `/api/provision`, `/keys/*`, `/me/usage`
  - Add to `dexto.ai/docs` (future)

---

## Phase 9 — Migration & Future Work ⏸️ FUTURE

### Potential Migrations
- [ ] If moving from `dexto.ai/api` to `api.dexto.ai`:
  - Keep `/v1` stable
  - Add redirects from old URLs
  - Switch dashboard to token-based API calls (no cookies)

### Future Features
- [ ] **Team wallets**:
  - Shared balance across team members
  - Role-based API keys (admin, developer, viewer)
  - Usage caps per team member
- [ ] **Invoices & exports**:
  - Monthly PDF invoices
  - CSV export of usage history
  - Receipts for Stripe transactions
- [ ] **Additional providers**:
  - Direct Anthropic, OpenAI integrations (if OpenRouter is down)
  - Allow users to choose provider preference
- [ ] **Model allowlist curation**:
  - Hide unreliable/expensive models by default
  - "Recommended" models for cost/performance
- [ ] **Premium tiers**:
  - SLA guarantees (99.99% uptime)
  - Priority routing
  - Dedicated support

---

## Open Questions & Decisions Needed

- [ ] **Pricing strategy**: Flat platform fee vs per-model markup?
  - Current: Pass-through OpenRouter BYOK costs (0% markup)
  - Alternative: Add 10-20% markup for managed service value
- [ ] **Models to block/remap**:
  - Should we hide expensive/unreliable models by default?
  - Create curated "recommended" list?
- [ ] **Rate limit tiers**:
  - Free tier: 60 req/min
  - Paid tier: 600 req/min (if user has >$10 balance)?
- [ ] **SLA and support**:
  - Free support: Discord + email
  - Premium support: Dedicated Slack channel?
- [ ] **Region selection**:
  - Deploy API to multiple Vercel regions (bom1, sfo1, iad1)?
  - Route users to nearest region?
- [ ] **Public vs auth for `/v1/models`**:
  - Currently public (no auth required)
  - Should we require auth to prevent abuse?

---

## Summary: Next 3 Critical Tasks

1. **CLI Billing Commands** 🚨 HIGH PRIORITY
   - Add `dexto billing status` and `dexto billing history` commands
   - Add credit warnings after LLM requests
   - ETA: 1-2 days

2. **CLI Key Management Commands** 🚨 HIGH PRIORITY
   - Add `dexto keys list` and `dexto keys rotate` commands
   - Remove OpenRouter POC commands (`dexto openrouter status`, `dexto openrouter regenerate`)
   - ETA: 1 day

3. **Landing Page Migration** 🚨 BLOCKS DASHBOARD
   - Migrate `dexto-lp` to `dexto-web/apps/web`
   - Set up Vercel deployment
   - Unblocks Phase 5 (Dashboard)
   - ETA: 2-3 days
