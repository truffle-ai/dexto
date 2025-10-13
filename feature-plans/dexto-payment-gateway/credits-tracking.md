# Credits Tracking & UX (MVP)

## Data
- `balances (user_id, credits_cents)` — wallet balance.
- `usage (user_id, key_id, model, input_tokens, output_tokens, cost_cents, ts)` — immutable ledger.
- Price table: server-side map of OpenRouter model → USD per-token rates.
- `api_keys (id, user_id, hash, scope, status, created_at)` — hashed DEXTO_API_KEYs.

## Request lifecycle (Gateway) — canonical metering
1. Authenticate `DEXTO_API_KEY` → userId.
2. Validate model against allowlist (OpenRouter cache).
3. For POST `/v1/chat/completions`:
   - Optionally pre-check minimum credit (guard): cost for `min(estimated_output, 1k tokens)`.
   - Select upstream key: the user’s per‑user OpenRouter key (create on demand if missing).
   - Forward to OpenRouter with that upstream key.
   - Read response `usage` (OpenRouter-provided) or estimate tokens; compute `cost_cents`.
     - Always send `usage: { include: true }` to receive authoritative credit cost and token counts from OpenRouter.
     - When `include_byok_in_limit` is true on the user’s OR key, BYOK usage decrements the same credit limit; org credits are not consumed for BYOK.
   - Optionally mirror wallet changes to the upstream key’s spending limit (raise/lower) as a safety net.
   - Upsert usage row; decrement wallet.
   - Return response with headers:
     - `X-Dexto-Credits-Remaining: <cents>`
     - `X-Dexto-Cost-Cents: <cents>`
     - `X-Dexto-RateLimit-Remaining: <n>` (optional)

## CLI safeguards — reuse local usage for UX only
- Before call: optionally fetch `/me/usage` to show balance.
- After call: read `X-Dexto-Credits-Remaining`; if < threshold, print warning and suggest top-up.
- If 402: print friendly message with link `dexto.ai/dashboard/topup`.

Notes:
- Vercel AI SDK exposes `response.totalUsage` in our client code (we already surface this in events). Use it to show progress/estimates in the CLI/UI, but do not use it for billing — billing is computed on the gateway.
- If the session may exceed current balance, the gateway should 402 early based on a conservative guard; optionally pre‑reserve against `max_output_tokens` when provided.

## BYOK-specific accounting
- Persist both `usage.cost` (OpenRouter credits) and, when present, `usage.cost_details.upstream_inference_cost` for receipts.
- Top-ups raise the user key’s `limit` via OpenRouter (PATCH); no custom price arithmetic in the gateway.
 - Gateway should surface a consistent “credits remaining” via header and/or `/me/usage`, sourced from OpenRouter `limit_remaining`.

## Streaming edge cases
- Minimal: early 402 if `balance_cents < guard_cents`.
- Optional (later): soft negative buffer (e.g., allow −$0.20) to finish current stream, then block.
- Optional (later): pre-reserve credits based on `max_output_tokens`, refund delta after completion.

## UI
- Dashboard shows:
  - Current credits, MTD cost, model breakdown.
  - Top-up button, key management (rotate/revoke), invoices.
- Chat UI (if applicable): a small “Credits: $X.XX” indicator; red when low.

## Telemetry
- Log userId, keyId, model, tokens, cost, latency, status.
- No prompts or keys in logs.
