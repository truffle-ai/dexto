# Gateway Handlers (Implementation Outline)

Applies to `dexto-web` (unified repo). Use Next.js route handlers or Vercel functions.

## Shared utils
- `auth.ts`: resolve user from `DEXTO_API_KEY` (hash lookup) and Supabase session tokens.
- `wallet.ts`: get/update `balances` (atomic decrement with check), fetch MTD usage.
- `openrouter.ts`: call OpenRouter with provided upstream key; thin wrapper around `fetch`.
- `pricing.ts`: map model → per-token rates; compute `cost_cents` from usage.
- `rate-limit.ts`: per-user token bucket (consider Upstash Redis or Supabase for shared state).
- `redact.ts`: ensure prompts/keys never logged.

## POST /api/provision
Pseudo-code:
```
assert Supabase session (Bearer)
user := getUserFromSession()

// Ensure per-user OR key exists
keyRec := getOpenRouterKey(user)
if !keyRec:
  keyRec := mintOpenRouterKey(user.email, user.id, {
    include_byok_in_limit: true,
    limit: purchasedCredits,        // set on first provision, PATCH on top-ups
    // limit_reset: 'monthly'       // optional for subscriptions
  })  // store encrypted, keep hash as keyId

// Ensure DEXTO_API_KEY exists
apiKey := getActiveDextoKey(user)
if !apiKey: apiKey := issueDextoKey(user)  // generate plaintext, store hash; return plaintext once

return { success: true, dextoApiKey: apiKey.plaintext, keyId: keyRec.hash, isNewKey: !previous }
```

## POST /v1/chat/completions
Pseudo-code:
```
user := authByDextoKey(Authorization)
assert rateLimit(user)

// Guard balance
if balance(user) < guard_cents: return 402

body := parseOpenAIChatPayload(request)
model := body.model

// Upstream call
orKey := getOpenRouterKey(user) // ensure exists
resp := fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${orKey.plaintext}` },
  body: JSON.stringify({
    ...body,
    usage: { include: true },
    // steer BYOK when desired
    provider: body.provider ?? { order: ['openai'] }, // or ['anthropic']
  })
})

// Read usage; fallback estimate if missing
usage := await readUsageFromResponse(resp) // { input_tokens, output_tokens, total_tokens }
cost := pricing.compute(model, usage)

// Atomic wallet update + ledger insert
ok := decrementWallet(user, cost)
if !ok: return 402  // edge race
recordUsage(user, keyId, model, usage, cost)

// Return proxied body with credits headers
return proxyResponse(resp, headers={ X-Dexto-Credits-Remaining, X-Dexto-Cost-Cents })
```

Streaming:
- Use `fetch` with streaming; buffer until trailers or a closing chunk to get usage if OpenRouter sends it only at the end.
- If usage only available at the end, compute cost after stream completes; then update wallet + send a trailing header (or finish with a final header if supported). If trailers not possible, compute cost after completion and ignore header emission for streams (CLI can poll `/me/usage`).

## GET /v1/models
```
user := authByDextoKey(Authorization) (optional)
models := getCachedOpenRouterModels()
return { data: models, fetchedAt }
```

## GET /me/usage
```
user := authByDextoKey(Authorization)
bal := getBalance(user)
mtd := getMtdUsage(user)
recent := getRecentUsage(user, limit=20)
return { credits_cents: bal, mtd_usage: mtd, recent }
```

## POST /api/keys/rotate
```
user := getUserFromSession()
revokeActiveDextoKey(user)
newKey := issueDextoKey(user)
return { success: true, dextoApiKey: newKey.plaintext }
```

## Security & Limits
- CORS: restrict to CLI/first-party origins only (browser calls). Node fetch ignores CORS.
- Rate limits: 1 rps per user (configurable), burst 5; 429 with Retry-After.
- Timeouts: 60s per request default; cancel upstream accordingly.
- Logging: structured, no prompts or secrets.
