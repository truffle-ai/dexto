# Dexto Payment Gateway (MVP Plan)

## Goal
Monetize the Dexto CLI with minimal changes by adding a managed gateway that lets users pay for usage with credits while preserving all existing BYOK flows.

## Provider Choice & Conventions
- Add a dedicated provider: `dexto` (similar to `openrouter`, which is itself OpenAI-compatible under the hood).
- Router: keep using existing routers (`vercel` or `in-built`). No new router type.
- Base URL: auto-inject `https://api.dexto.ai/v1` when `provider === 'dexto'`.
- API key: `DEXTO_API_KEY` (per user, issued by Dexto; stored hashed server-side).
- Model IDs: follow OpenRouter conventions (e.g., `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`).
  - Validation: reuse the OpenRouter models cache (`~/.dexto/cache/openrouter-models.json`) to validate `dexto` models (treat unknown cache state as non-blocking, just like OpenRouter).

Why a separate provider?
- Clear analytics/UX: you can distinguish configs that go through the paid Dexto gateway (`provider: dexto`) vs free BYOK (`provider: openrouter` or native providers).
- Minimal code changes: mirror the existing `openrouter` handling (baseURL injection, Vercel/OpenAI client setup, validation) with `dexto` constants.

## Supported Mode (Login Flow)
- Dexto Credits (Paid): `provider: dexto`, `baseURL: https://api.dexto.ai/v1`, `apiKey: $DEXTO_API_KEY`.
  - On login, we return only a Dexto-issued `DEXTO_API_KEY`.
  - The gateway mints/uses a per-user OpenRouter key internally and never returns it to the client.
  - BYOK (user-supplied provider keys) can still be configured manually by advanced users, but is not part of the login provisioning.
  - No backward compatibility required (feature not shipped yet).

### Key Semantics (Decision)
- Per-user OpenRouter keys are minted and stored server-side (encrypted) for every logged-in user. These are used only by the Dexto gateway.
- The only credential returned to the client is `DEXTO_API_KEY`.
- We do not return OpenRouter keys to the client in this flow.

Pros:
- Upstream isolation and revocation per user; optional per-key spending caps at OpenRouter.
- Clear audits per user at OpenRouter + internal wallet ledger.

Cons:
- More lifecycle management (rotation/limits sync). We’ll keep keys server-side only for paid path to reduce risk.

## Backend (Gateway) MVP
- Host under `api.dexto.ai` (preferred) (Vercel/Supabase Edge compatible).
- Endpoints (OpenAI-compatible):
  - `POST /v1/chat/completions` → proxy to `https://openrouter.ai/api/v1/chat/completions` with Dexto org key.
  - `GET /v1/models` → proxy OpenRouter list (optionally filtered or cached).
  - `GET /me/usage` → return remaining credits + month-to-date usage.
- Auth: `Authorization: Bearer DEXTO_API_KEY` (lookup by hashed key → user → wallet).
- Metering/Billing:
  - Use OpenRouter cost fields when available; else compute via known prices per model.
  - Deduct credits; if insufficient, return 402 with friendly message.
  - Per-user rate limit (e.g., 1 rps, small burst) and daily caps.
- Security:
  - Never log prompts/keys. Log userId, keyId, model, token counts, cost.
  - Key rotation/revocation; scopes (chat:write, models:read).

## Data Model (Supabase)
- `users`
- `api_keys` (id, user_id, hash, created_at, status, scope)
- `balances` (user_id, credits_cents)
- `usage` (user_id, key_id, model, input_tokens, output_tokens, cost_cents, ts)
- `stripe_customers`, `stripe_transactions`
- `allowed_models` (optional) with price mapping (seeded from cached OpenRouter list)

## Stripe (Top-ups First)
- Checkout Sessions for credit packs ($5, $10, etc.).
- Webhook updates `balances` and records `stripe_transactions`.
- Optional intro credit (e.g., $1) for new users.

## CLI Integration
- Auto-detect the best path:
  - If `DEXTO_API_KEY` exists → write preferences using `provider: dexto` with auto baseURL;
    - `provider: dexto`
    - `baseURL: https://api.dexto.ai/v1`
    - `apiKey: $DEXTO_API_KEY`
  - Else guide user to `dexto login` to obtain DEXTO_API_KEY (or manual BYOK for advanced users outside of login).

- UX safeguards:
  - Preflight optional: call `/me/usage` to display balance.
  - Read `X-Dexto-Credits-Remaining` header after each request and warn when low.
  - On `402`, print friendly message and link to top-up.

## Domain Choice: `api.dexto.ai` vs `dexto.ai/api`
- Prefer `api.dexto.ai`:
  - Clear cookie/CORS isolation from the marketing/app domain.
  - Independent WAF, rate limits, and deploy cadence for the API.
  - Stable CLI base URL: `https://api.dexto.ai/v1`.
- `dexto.ai/api` works but shares cookies and ties deploys together; choose only if infra constraints require it.

## OpenRouter Credits (BYOK) – Explicit Behavior
- Per-user OpenRouter key minted server-side with:
  - `limit = credits_purchased` (acts as user-visible balance),
  - `include_byok_in_limit = true` (BYOK usage decrements the same limit),
  - optional `limit_reset = monthly` (for subscriptions).
- For every upstream call, set `usage: { include: true }` so OpenRouter returns usage + credit cost.
- Route BYOK explicitly with `provider: { order: ["openai"] }` (or `"anthropic"`, etc.) when needed; OpenRouter selects your linked BYOK.
- Display user balance from OpenRouter’s key (`limit_remaining`, `usage_monthly`, `byok_usage_monthly`), or surface it via gateway headers.
- Top-ups = `PATCH /api/v1/keys/{hash}` to increase `limit` (no custom price math in gateway).

## Provisioning Endpoint Changes
- Replace current behavior in `../functions/openrouter-provision/api/openrouter-provision.ts`:
  - Always verify Supabase session.
  - Ensure a per-user OpenRouter key exists (create if missing), store/update it (encrypted) as today.
  - Issue (or return existing) `DEXTO_API_KEY` and return only that to the client, along with `keyId` metadata.
  - Never include the upstream OpenRouter `apiKey` in any response.
  - Optional: add endpoints to rotate the per-user OpenRouter key and to adjust upstream spending limits to mirror wallet.

Response example:
- `{ success, dextoApiKey, keyId, isNewKey }` (no upstream `apiKey`)

## API Contracts (MVP)
- POST `/api/provision`
  - Auth: Supabase session Bearer token (from CLI OAuth).
  - Body: `{}` (no params) — server decides mint-or-fetch.
  - Behavior: ensure per-user OR key exists (encrypted), mint/reuse DEXTO_API_KEY, return it.
  - Response: `{ success: true, dextoApiKey: string, keyId: string, isNewKey: boolean }`.

- POST `/v1/chat/completions`
  - Auth: `Authorization: Bearer DEXTO_API_KEY`.
  - Body: OpenAI chat payload (model uses OpenRouter id strings).
  - Behavior: select upstream per-user OR key, forward to OpenRouter, meter usage, decrement wallet, return response.
  - Headers: `X-Dexto-Credits-Remaining`, `X-Dexto-Cost-Cents` (and optional rate limit header).

- GET `/v1/models`
  - Auth: `Authorization: Bearer DEXTO_API_KEY` (or public if preferred).
  - Behavior: return cached OpenRouter models list (or proxy).

- GET `/me/usage`
  - Auth: `Authorization: Bearer DEXTO_API_KEY`.
  - Behavior: return `{ credits_cents, mtd_usage: {...}, recent: [...] }`.

- POST `/api/keys/rotate` (web UI)
  - Auth: Supabase session.
  - Behavior: revoke old DEXTO_API_KEY, issue new, return once.

- POST `/api/openrouter-key/rotate` (web UI)
  - Auth: Supabase session.
  - Behavior: mint new per-user OR key, update encrypted storage, do not return raw key.
- Commands (phase 2):
  - `dexto billing status` (credits, MTD usage)
  - `dexto billing topup` (opens Stripe Checkout)

## Incentives to Use Dexto Credits
- Frictionless: works after `dexto login` with one key everywhere.
- Consolidated billing and receipts; simple per-model pricing table.
- Free starter credit; fair rate limits; model allowlist tuned for reliability.
- Teams (later): shared wallets, usage caps, role-based keys.
 - Optional benefits over BYOK OpenRouter: availability SLAs, pre-warmed routing, priority limits, curated “good defaults”.

## Model Conventions
- Accept OpenRouter model ids across the gateway. This matches our current OpenRouter-based UX and avoids dual naming.
- BYOK (OpenRouter) users see identical model behavior.
- If we add aliases, do it server-side (keep CLI transparent).

## Rollout Plan
1) MVP
- Issue `DEXTO_API_KEY`; proxy `/v1/chat/completions` + `/v1/models`.
- Stripe top-ups → webhook → wallet credit.
- CLI: detect `DEXTO_API_KEY` and write `openai-compatible` + baseURL prefs.
2) Phase 2
- Billing commands; subscriptions with included credits.
- Team wallets; downloadable invoices; usage exports.

## Open Questions
- Do we want per-model markups or a flat platform fee?
- Any models to block or remap by default (cost or reliability)?
- SLA and support tiers (for premium)?

## Notes
- Keep BYOK free for OpenAI/Anthropic (no proxy). Monetize value-adds later.
- Gateway logs must stay secret-safe and structured for abuse detection.
