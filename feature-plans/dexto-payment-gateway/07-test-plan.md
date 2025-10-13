# Test Plan (MVP)

## Unit tests
- auth: `DEXTO_API_KEY` hashing/lookup; Supabase session verification.
- wallet: atomic decrement (simulate race), balance floor checks.
- pricing: model→rate mapping; cost calculation from usage.
- rate-limit: token bucket grant/deny paths.
- redact: no prompts or keys in logs.

## Integration tests (API)
- /api/provision
  - Valid session → returns dextoApiKey, keyId; creates encrypted OR key if missing.
  - Missing/invalid session → 401.
- /v1/chat/completions
  - Valid key + adequate balance → 200; returns credits headers; ledger record written.
  - Low balance → 402; no ledger written; no balance change.
  - Rate limit exceeded → 429.
  - Upstream error → 5xx; redacted logs.
  - With BYOK routing and `include_byok_in_limit: true`, user key’s limit is decremented and headers reflect remaining credits; org wallet is not charged by OR.
- /v1/models
  - Returns cached list; respects auth policy.
- /me/usage
  - Returns balance/MTD/recent for authorized users; 401 otherwise.

## Streaming
- Simulate streaming from OpenRouter; ensure we still compute billing from final usage and do not leak tokens mid-stream.
 - Verify that the final usage includes OpenRouter’s `usage.cost`; for BYOK, ensure `upstream_inference_cost` is recorded.

## CLI
- login flow persists DEXTO_API_KEY and writes provider: dexto.
- headers are parsed; warnings printed when low credits.
- `billing status` prints MTD stats; handles 401.

## Security
- CORS restricted; unauthorized browsers blocked from state-changing endpoints.
- Keys stored hashed (DEXTO_API_KEY), encrypted (OpenRouter keys) with AES-256-GCM; rotation tests.
- RLS policies enforced for user-owned tables.
