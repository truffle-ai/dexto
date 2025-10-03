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

## Supported Modes
- BYOK (OpenRouter): `provider: openrouter`, `baseURL: https://openrouter.ai/api/v1`, `apiKey: $OPENROUTER_API_KEY`.
- BYOK (Native): `provider: openai|anthropic|google|…`, direct keys (no billing by Dexto).
- Dexto Credits (Paid): `provider: dexto`, `baseURL: https://api.dexto.ai/v1`, `apiKey: $DEXTO_API_KEY`.

### Key Semantics (Decision)
- We will use per-user OpenRouter keys for the paid `dexto` path, leveraging the existing minting logic in `../functions/openrouter-provision`.
  - `DEXTO_API_KEY` authenticates to Dexto; the gateway selects the user’s OpenRouter key (stored encrypted in Supabase) for upstream calls.
  - The per-user OpenRouter key is never returned to the client for the `dexto` path.
  - BYOK `openrouter` remains a separate, free path that returns the OpenRouter key to the user for direct usage if they choose.

Pros:
- Upstream isolation and revocation per user; optional per-key spending caps at OpenRouter.
- Clear audits per user at OpenRouter + internal wallet ledger.

Cons:
- More lifecycle management (rotation/limits sync). We’ll keep keys server-side only for paid path to reduce risk.

## Backend (Gateway) MVP
- Host under `dexto.ai` (Vercel/Supabase Edge compatible).
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
  - Else if logged in and OpenRouter key provisioned → keep current OpenRouter flow.
  - Else BYOK native providers via setup.

- UX safeguards:
  - Preflight optional: call `/me/usage` to display balance.
  - Read `X-Dexto-Credits-Remaining` header after each request and warn when low.
  - On `402`, print friendly message and link to top-up.

## Provisioning Endpoint Changes
- Current: `../functions/openrouter-provision/api/openrouter-provision.ts` mints and returns an OpenRouter key (and stores it encrypted) after verifying the Supabase session.
- New behavior:
  - Accept a `mode` parameter: `mode=byok` (return key to client) or `mode=managed` (do NOT return upstream key).
  - In `managed` mode:
    - Ensure a per-user OpenRouter key exists (create if missing), store/update it as today.
    - Return only a Dexto-issued `DEXTO_API_KEY` (or reuse an existing one) for CLI usage.
    - Do not include `apiKey` (OpenRouter) in the response.
  - Optional: expose an endpoint to rotate per-user OpenRouter keys (`POST /api/openrouter-key/rotate`) and to adjust per-key upstream spending limits to mirror wallet.

Response examples:
- BYOK: `{ success, apiKey, keyId, isNewKey }`
- Managed: `{ success, dextoApiKey, keyId, isNewKey }` (no upstream `apiKey`)
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
