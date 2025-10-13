# Dexto Gateway API Contracts (MVP)

All endpoints live under `https://api.dexto.ai` (or `https://dexto.ai/api`). Paths below assume the base URL.

## Auth
- CLI login obtains a Supabase session token via OAuth.
- Provisioning uses the Supabase session token (Bearer) to issue a `DEXTO_API_KEY`.
- Gateway endpoints use `DEXTO_API_KEY` in `Authorization: Bearer <key>`.

## Errors
- 401 Unauthorized: missing/invalid auth.
- 402 Payment Required: insufficient balance (for completions).
- 429 Too Many Requests: per-user rate limit exceeded.
- 5xx: upstream or internal errors (redacted).

## POST /api/provision
Issue a DEXTO_API_KEY; ensure per-user OpenRouter key exists (encrypted), never returned.

- Auth: `Authorization: Bearer <Supabase session JWT>`
- Body: `{}`
- Response 200:
```json
{
  "success": true,
  "dextoApiKey": "dxk_...",  
  "keyId": "or_key_hash_or_id",
  "isNewKey": true
}
```
- Notes:
  - If a DEXTO_API_KEY already exists, return the existing one (do not rotate).
  - If the per-user OpenRouter key is missing, mint it via OpenRouter, store encrypted, save hash/id as `keyId`.
  - Set `include_byok_in_limit: true` and `limit` to purchased credits; optionally set `limit_reset: monthly` for subscriptions.
  - Do not return the OpenRouter key.
  - Requires org provisioning key: `OPENROUTER_PROVISIONING_KEY` (server-side secret).

## POST /v1/chat/completions
OpenAI-compatible chat endpoint. Proxy to OpenRouter using the per-user OR key.

- Auth: `Authorization: Bearer <DEXTO_API_KEY>`
- Body: OpenAI chat request (model id uses OpenRouter naming, e.g. `openai/gpt-4o`)
- Response 200: OpenAI-compatible response (proxied).
- Headers:
  - `X-Dexto-Credits-Remaining: <integer_cents>`
  - `X-Dexto-Cost-Cents: <integer_cents>`
  - Optional: `X-Dexto-RateLimit-Remaining: <integer>`
- Failure:
  - 402 if balance below guard.
  - 429 if per-user rate limit exceeded.

Behavioral notes:
- Always set `usage: { include: true }` in the upstream body to get OpenRouter’s credit cost and token counts.
- To prefer BYOK upstreams, include `provider: { order: ["openai"] }` or `{"anthropic"}` as appropriate.
- With `include_byok_in_limit: true` on the user’s OR key, BYOK usage decrements the same credit limit (user-visible balance) without spending org credits.

## GET /v1/models
Return cached OpenRouter model list.

- Auth: `Authorization: Bearer <DEXTO_API_KEY>` (or omit if public)
- Response 200:
```json
{
  "data": [
    { "id": "openai/gpt-4o", "display": "OpenAI GPT-4o" },
    { "id": "anthropic/claude-3.5-sonnet", "display": "Claude 3.5 Sonnet" }
  ],
  "fetchedAt": "2025-10-03T09:22:49.577Z"
}
```

## GET /me/usage
Return wallet balance and recent usage summary.

- Auth: `Authorization: Bearer <DEXTO_API_KEY>`
- Response 200:
```json
{
  "credits_cents": 1234,
  "mtd_usage": { "cost_cents": 321, "requests": 42 },
  "recent": [
    { "ts": "2025-10-03T10:00:00Z", "model": "openai/gpt-4o", "cost_cents": 7, "input_tokens": 800, "output_tokens": 120 }
  ]
}
```

## POST /api/keys/rotate (dashboard-only)
Rotate DEXTO_API_KEY.

- Auth: Supabase session cookie
- Response 200: `{ success: true, dextoApiKey: "dxk_..." }` (plaintext returned once)

