# Credits Tracking & UX (MVP)

## Data
- `balances (user_id, credits_cents)` — wallet balance.
- `usage (user_id, key_id, model, input_tokens, output_tokens, cost_cents, ts)` — immutable ledger.
- Price table: server-side map of OpenRouter model → USD per-token rates.

## Request lifecycle (Gateway)
1. Authenticate `DEXTO_API_KEY` → userId.
2. Validate model against allowlist (OpenRouter cache).
3. For POST `/v1/chat/completions`:
   - Optionally pre-check minimum credit (guard): cost for `min(estimated_output, 1k tokens)`.
   - Forward to OpenRouter.
   - Read response `usage` or estimate tokens; compute `cost_cents`.
   - Upsert usage row; decrement wallet.
   - Return response with headers:
     - `X-Dexto-Credits-Remaining: <cents>`
     - `X-Dexto-Cost-Cents: <cents>`
     - `X-Dexto-RateLimit-Remaining: <n>` (optional)

## CLI safeguards
- Before call: optionally fetch `/me/usage` to show balance.
- After call: read `X-Dexto-Credits-Remaining`; if < threshold, print warning and suggest top-up.
- If 402: print friendly message with link `dexto.ai/dashboard/topup`.

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
