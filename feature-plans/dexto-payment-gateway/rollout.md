# Rollout Plan (MVP)

## Prerequisites
- DNS `api.dexto.ai` → Vercel project (dexto-web).
- Supabase project with `api_keys`, `balances`, `usage_ledger`, `openrouter_keys`.
- Vercel env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY.
- OpenRouter provisioning key for admin minting.

## Steps
1. Move `../functions/openrouter-provision` into `dexto-web/apps/api` (or `src/app/api`).
2. Implement new `/api/provision` (session auth; ensure per-user OR key; return DEXTO_API_KEY only).
   - On first provision, mint per-user OR key with `include_byok_in_limit: true` and `limit = purchased_credits` (set/reset via PATCH on top-ups). Optionally set `limit_reset: monthly`.
3. Add `/v1/chat/completions`, `/v1/models`, `/me/usage` handlers.
   - Always set `usage: { include: true }` on upstream requests; prefer BYOK routing via `provider: { order: ["openai"] }` or similar when desired.
4. Add wallet ops: decrement with guard; usage ledger insert; rate limit.
5. Deploy dexto-web to Vercel; verify endpoints with curl.
6. Update `packages/cli/package.json:config.dexto_api_url` to `https://api.dexto.ai`.
7. Update CLI login to consume `/api/provision` and write `provider: dexto` preferences.
8. Ship CLI; test end-to-end: login → run chat → see credits headers → `billing status`.

## Post-launch
- Add Stripe top-ups (webhooks → balances).
- Add dashboard: show DEXTO_API_KEY, credits, usage charts, rotate keys.
- Tighten model allowlist; publish pricing; add SLAs/limits.
